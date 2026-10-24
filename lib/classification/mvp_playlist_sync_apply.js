/**
 * MVP Spotify 同步 apply 輔助（可單元測試）
 */
import {
  SYNC_STATUS_COMPLETE,
  SYNC_STATUS_SYNCING,
  SYNC_STATUS_FAILED,
  SYNC_STATUS_INTERRUPTED,
} from './mvp_playlist_sync_manifest.js';
import crypto from 'node:crypto';
import { chunk_uris, SPOTIFY_ADD_TRACKS_MAX } from '../spotify_playlists_write.js';
import { SpotifyRequestError } from '../spotify_api.js';

/**
 * @param {string[]} uris
 */
function compute_track_list_hash_local(uris) {
  const sorted = (uris || []).slice().sort();
  return crypto.createHash('sha256').update(sorted.join('\n')).digest('hex');
}

export const DEFAULT_VERIFY_READ_ATTEMPTS = 3;
export const DEFAULT_VERIFY_DELAY_MS = 0;

/**
 * @param {string[]} to_add
 */
export function compute_sync_add_plan_hash(to_add) {
  return compute_track_list_hash_local(to_add || []);
}

/**
 * 僅當 checkpoint 與本輪 to_add／批次計畫一致時才續傳 add_batches_done
 * @param {object|null} row
 * @param {string} catalog_hash
 * @param {string[]} to_add
 * @param {number} batch_size
 */
export function resolve_sync_batch_progress(row, catalog_hash, to_add, batch_size) {
  const batches = chunk_uris(to_add || [], batch_size || SPOTIFY_ADD_TRACKS_MAX);
  const add_plan_hash = compute_sync_add_plan_hash(to_add);
  const prev = row || {};
  const checkpoint_ok =
    prev.sync_target_catalog_hash === catalog_hash &&
    prev.sync_add_plan_hash === add_plan_hash &&
    prev.add_batches_total === batches.length &&
    typeof prev.add_batches_done === 'number' &&
    prev.add_batches_done >= 0 &&
    prev.add_batches_done <= batches.length;

  let start_batch = 0;
  if (checkpoint_ok && prev.sync_status === SYNC_STATUS_INTERRUPTED) {
    start_batch = prev.add_batches_done;
  } else if (checkpoint_ok && prev.sync_status === SYNC_STATUS_SYNCING) {
    start_batch = prev.add_batches_done || 0;
  } else {
    start_batch = 0;
  }

  return {
    batches: batches,
    add_batches_total: batches.length,
    add_batches_done_start: start_batch,
    sync_add_plan_hash: add_plan_hash,
    sync_target_catalog_hash: catalog_hash,
    checkpoint_resumed: checkpoint_ok && start_batch > 0,
    checkpoint_reset: !checkpoint_ok,
  };
}

/**
 * @param {Set<string>|{ has: function}} online
 * @param {string[]} catalog_uris
 */
export function catalog_uris_missing_on_spotify(online, catalog_uris) {
  /** @type {string[]} */
  const missing = [];
  const list = catalog_uris || [];
  for (let i = 0; i < list.length; i += 1) {
    const u = list[i];
    if (!online.has(u)) {
      missing.push(u);
    }
  }
  return missing;
}

/**
 * @param {Set<string>} before
 * @param {Set<string>} after
 * @param {string[]} to_add
 */
export function count_newly_added_uris(before, after, to_add) {
  let n = 0;
  for (let i = 0; i < (to_add || []).length; i += 1) {
    const u = to_add[i];
    if (after.has(u) && !before.has(u)) {
      n += 1;
    }
  }
  return n;
}

/**
 * manifest complete + hash 相同時，仍須線上驗證 catalog URI 全在
 * @param {object|null} row
 * @param {object} pl
 * @param {Set<string>} online
 */
export function should_skip_playlist_as_fully_synced(row, pl, online) {
  if (!row || !row.spotify_playlist_id) {
    return false;
  }
  if (row.sync_status !== SYNC_STATUS_COMPLETE) {
    return false;
  }
  if (row.track_list_hash !== pl.track_list_hash) {
    return false;
  }
  const missing = catalog_uris_missing_on_spotify(online, pl.uris);
  return missing.length === 0;
}

/**
 * @param {object} params
 */
export async function verify_catalog_uris_on_spotify(params) {
  const p = params || {};
  const fetch_fn = p.fetch_playlist_track_uris;
  const playlist_id = p.spotify_playlist_id;
  const catalog_uris = p.catalog_uris || [];
  const attempts =
    typeof p.verify_read_attempts === 'number'
      ? p.verify_read_attempts
      : DEFAULT_VERIFY_READ_ATTEMPTS;
  const delay_ms =
    typeof p.verify_delay_ms === 'number' ? p.verify_delay_ms : DEFAULT_VERIFY_DELAY_MS;
  const api_opts = p.api_opts || {};

  /** @type {Set<string>} */
  let online = new Set();
  /** @type {string[]} */
  let missing = catalog_uris.slice();

  for (let a = 0; a < attempts; a += 1) {
    online = await fetch_fn(playlist_id, api_opts);
    missing = catalog_uris_missing_on_spotify(online, catalog_uris);
    if (missing.length === 0) {
      return { ok: true, online: online, missing: [], attempts: a + 1 };
    }
    if (a < attempts - 1 && delay_ms > 0) {
      await new Promise(function (resolve) {
        setTimeout(resolve, delay_ms);
      });
    }
  }

  return { ok: false, online: online, missing: missing, attempts: attempts };
}

/**
 * 單張歌單 apply（可注入 mock API）
 * @param {object} pl - sync plan playlist row
 * @param {object} row - manifest row（會被 mutate）
 * @param {object} deps
 */
export async function apply_one_mvp_playlist_sync(pl, row, deps) {
  const fetch_uris = deps.fetch_playlist_track_uris;
  const add_tracks = deps.add_tracks_to_playlist;
  const create_playlist = deps.create_private_playlist;
  const api_opts = deps.api_opts || {};
  const verify_read_attempts = deps.verify_read_attempts;
  const verify_delay_ms = deps.verify_delay_ms;

  if (!row.spotify_playlist_id && create_playlist) {
    const created = await create_playlist(
      {
        name: pl.spotify_name,
        description: pl.description_zh,
      },
      api_opts
    );
    row.spotify_playlist_id = created.spotify_playlist_id;
    row.spotify_name = created.name;
    row.created_at = row.created_at || new Date().toISOString();
  }

  if (!row.spotify_playlist_id) {
    throw new Error('缺少 spotify_playlist_id');
  }

  const online_before_skip = await fetch_uris(row.spotify_playlist_id, api_opts);
  if (should_skip_playlist_as_fully_synced(row, pl, online_before_skip)) {
    return {
      skipped: true,
      reason: 'already_complete_verified',
      mvp_playlist_id: pl.mvp_playlist_id,
      spotify_playlist_id: row.spotify_playlist_id,
      added_uris: 0,
      status: SYNC_STATUS_COMPLETE,
    };
  }

  row.catalog_display_name = pl.spotify_name;
  row.sync_status = SYNC_STATUS_SYNCING;
  row.track_list_hash = pl.track_list_hash;
  row.valid_uri_count = pl.valid_uri_count;

  const existing_before = await fetch_uris(row.spotify_playlist_id, api_opts);
  /** @type {string[]} */
  const to_add = [];
  for (let u = 0; u < pl.uris.length; u += 1) {
    const uri = pl.uris[u];
    if (!existing_before.has(uri)) {
      to_add.push(uri);
    }
  }

  const batch_plan = resolve_sync_batch_progress(
    row,
    pl.track_list_hash,
    to_add,
    SPOTIFY_ADD_TRACKS_MAX
  );

  row.sync_add_plan_hash = batch_plan.sync_add_plan_hash;
  row.sync_target_catalog_hash = batch_plan.sync_target_catalog_hash;
  row.add_batches_total = batch_plan.add_batches_total;
  row.add_batches_done = batch_plan.add_batches_done_start;
  row.pending_add_uri_count = to_add.length;

  let post_attempted = 0;
  for (let b = batch_plan.add_batches_done_start; b < batch_plan.batches.length; b += 1) {
    const batch = batch_plan.batches[b];
    if (!batch.length) {
      continue;
    }
    await add_tracks(row.spotify_playlist_id, batch, api_opts);
    post_attempted += batch.length;
    row.add_batches_done = b + 1;
    if (deps.on_checkpoint) {
      deps.on_checkpoint(row);
    }
  }

  if (to_add.length > 0 && post_attempted === 0) {
    row.sync_status = SYNC_STATUS_FAILED;
    row.last_error = 'add_batches_skipped：待新增 URI 存在但未執行 POST（checkpoint 異常已重置後仍無批次）。';
    return {
      mvp_playlist_id: pl.mvp_playlist_id,
      spotify_playlist_id: row.spotify_playlist_id,
      added_uris: 0,
      post_attempted: 0,
      to_add_count: to_add.length,
      status: SYNC_STATUS_FAILED,
      error: row.last_error,
    };
  }

  const verify = await verify_catalog_uris_on_spotify({
    fetch_playlist_track_uris: fetch_uris,
    spotify_playlist_id: row.spotify_playlist_id,
    catalog_uris: pl.uris,
    verify_read_attempts: verify_read_attempts,
    verify_delay_ms: verify_delay_ms,
    api_opts: api_opts,
  });

  const added_uris = count_newly_added_uris(existing_before, verify.online, to_add);

  if (!verify.ok) {
    row.sync_status = SYNC_STATUS_INTERRUPTED;
    row.last_error =
      'post_sync_verify_failed：線上仍缺 ' +
      verify.missing.length +
      ' 首（catalog ' +
      pl.valid_uri_count +
      '／線上 ' +
      verify.online.size +
      '）。';
    row.verify_missing_uri_count = verify.missing.length;
    row.added_uris_verified = added_uris;
    return {
      mvp_playlist_id: pl.mvp_playlist_id,
      spotify_playlist_id: row.spotify_playlist_id,
      added_uris: added_uris,
      to_add_count: to_add.length,
      post_attempted: post_attempted,
      verify_missing_count: verify.missing.length,
      status: SYNC_STATUS_INTERRUPTED,
      error: row.last_error,
    };
  }

  row.sync_status = SYNC_STATUS_COMPLETE;
  row.completed_at = new Date().toISOString();
  row.add_batches_done = batch_plan.add_batches_total;
  row.last_error = null;
  row.verify_missing_uri_count = 0;
  row.added_uris_verified = added_uris;
  delete row.pending_add_uri_count;

  return {
    mvp_playlist_id: pl.mvp_playlist_id,
    spotify_playlist_id: row.spotify_playlist_id,
    added_uris: added_uris,
    to_add_count: to_add.length,
    post_attempted: post_attempted,
    status: SYNC_STATUS_COMPLETE,
  };
}

/**
 * @param {unknown} err
 */
export function map_sync_error_status(err) {
  if (err instanceof SpotifyRequestError) {
    if (err.status === 429) {
      return SYNC_STATUS_INTERRUPTED;
    }
    if (err.status === 403 || (err.status >= 500 && err.status < 600)) {
      return SYNC_STATUS_FAILED;
    }
  }
  return SYNC_STATUS_FAILED;
}
