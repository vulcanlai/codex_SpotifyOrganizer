/**
 * MVP 智慧歌單 → Spotify 同步（dry-run 預設；apply 需授權旗標）
 */
import crypto from 'node:crypto';
import {
  build_mvp_playlist_catalog,
  load_classification_index_for_mvp,
} from './mvp_smart_playlists.js';
import {
  MVP_SPOTIFY_PLAYLIST_NAME_PREFIX,
  mvp_spotify_title_from_catalog_label,
  spotify_playlist_display_name,
  mvp_sync_playlist_description_zh,
} from './mvp_spotify_playlist_naming.js';

export {
  MVP_SPOTIFY_PLAYLIST_NAME_PREFIX,
  mvp_spotify_title_from_catalog_label,
  spotify_playlist_display_name,
  mvp_sync_playlist_description_zh,
};
import {
  load_sync_manifest,
  save_sync_manifest,
  SYNC_STATUS_COMPLETE,
  SYNC_STATUS_SYNCING,
  SYNC_STATUS_CREATED,
  SYNC_STATUS_FAILED,
  SYNC_STATUS_INTERRUPTED,
  DEFAULT_MVP_SYNC_MANIFEST_PATH,
} from './mvp_playlist_sync_manifest.js';
import {
  has_mvp_sync_scopes,
  get_mvp_sync_missing_scopes,
  mvp_reauth_hint_zh,
} from '../auth/mvp_sync_scopes.js';
import {
  create_private_playlist,
  add_tracks_to_playlist,
  fetch_playlist_track_uris,
  chunk_uris,
  SPOTIFY_ADD_TRACKS_MAX,
} from '../spotify_playlists_write.js';
import { SpotifyRequestError } from '../spotify_api.js';
import {
  apply_one_mvp_playlist_sync,
  map_sync_error_status,
} from './mvp_playlist_sync_apply.js';
import {
  apply_human_rules_to_sync_playlist,
  load_rules_for_sync,
} from '../managed_playlists/sync_respect.js';

export {
  compute_sync_add_plan_hash,
  resolve_sync_batch_progress,
  catalog_uris_missing_on_spotify,
  count_newly_added_uris,
  should_skip_playlist_as_fully_synced,
  verify_catalog_uris_on_spotify,
  apply_one_mvp_playlist_sync,
} from './mvp_playlist_sync_apply.js';

export const MVP_SPOTIFY_SYNC_AUTHORIZE_TOKEN = 'I_UNDERSTAND_MVP_SPOTIFY_SYNC';

export const SPOTIFY_TRACK_ID_PATTERN = /^[a-zA-Z0-9]{22}$/;

/**
 * @param {string} track_id
 */
export function is_valid_spotify_track_id(track_id) {
  return typeof track_id === 'string' && SPOTIFY_TRACK_ID_PATTERN.test(track_id);
}

/**
 * @param {object|null} row
 * @param {string} track_id
 */
export function resolve_track_uri_for_sync(row, track_id) {
  if (!is_valid_spotify_track_id(track_id)) {
    return { ok: false, reason: 'invalid_id' };
  }
  if (!row) {
    return { ok: true, uri: 'spotify:track:' + track_id, source: 'id_only' };
  }
  const merged = row.merged_metadata || {};
  const uri = merged.uri;
  if (typeof uri === 'string' && uri.indexOf('spotify:track:') === 0) {
    return { ok: true, uri: uri, source: 'merged_metadata.uri' };
  }
  return { ok: true, uri: 'spotify:track:' + track_id, source: 'derived_from_id' };
}

/**
 * @param {string[]} uris
 */
export function compute_track_list_hash(uris) {
  const sorted = uris.slice().sort();
  return crypto.createHash('sha256').update(sorted.join('\n')).digest('hex');
}

/**
 * @param {object} catalog
 * @param {object} index_doc
 */
export function build_mvp_sync_plan(catalog, index_doc, opts) {
  const options = opts || {};
  const tracks_by_id = (index_doc && index_doc.tracks_by_id) || {};
  /** @type {object[]} */
  const playlists = [];
  const all_pl = (catalog.language_genre_playlists || catalog.genre_playlists || []).concat(
    catalog.emotion_playlists_tentative || []
  );
  const only_id = options.playlist_id || null;

  let total_valid_uris = 0;
  let total_invalid = 0;
  let total_api_create = 0;
  let total_api_add_batches = 0;

  for (let i = 0; i < all_pl.length; i += 1) {
    const pl = all_pl[i];
    if (only_id && pl.playlist_id !== only_id) {
      continue;
    }
    if (!pl.track_count || pl.track_count < 1) {
      continue;
    }
    const ids = pl.track_ids || [];
    /** @type {string[]} */
    const uris = [];
    /** @type {string[]} */
    const seen = {};
    for (let j = 0; j < ids.length; j += 1) {
      const id = ids[j];
      const resolved = resolve_track_uri_for_sync(tracks_by_id[id], id);
      if (!resolved.ok) {
        continue;
      }
      if (seen[resolved.uri]) {
        continue;
      }
      seen[resolved.uri] = true;
      uris.push(resolved.uri);
    }
    const invalid_excluded = ids.length - uris.length;
    total_invalid += invalid_excluded;
    total_valid_uris += uris.length;
    const add_batches = chunk_uris(uris, SPOTIFY_ADD_TRACKS_MAX).length;
    total_api_create += 1;
    total_api_add_batches += add_batches;

    playlists.push({
      mvp_playlist_id: pl.playlist_id,
      kind: pl.kind,
      spotify_name: spotify_playlist_display_name(pl),
      description_zh: mvp_sync_playlist_description_zh(pl),
      track_ids_requested: ids.length,
      valid_uri_count: uris.length,
      invalid_or_duplicate_excluded: invalid_excluded,
      track_list_hash: compute_track_list_hash(uris),
      uris: uris,
      estimated_api_requests: 1 + add_batches,
    });
  }

  const rules = options.rules || load_rules_for_sync(options);
  const has_rules = !!(rules && rules.playlists && Object.keys(rules.playlists).length);
  const manifest = options.manifest || (has_rules ? load_sync_manifest(options.manifest_path) : { playlists: {} });
  total_valid_uris = 0;
  total_api_create = 0;
  total_api_add_batches = 0;
  for (let a = 0; a < playlists.length; a += 1) {
    const adjusted = apply_human_rules_to_sync_playlist(playlists[a], rules, manifest);
    if (adjusted.skip_spotify_writes) {
      adjusted.track_list_hash = compute_track_list_hash([]);
      adjusted.estimated_api_requests = 0;
      adjusted.valid_uri_count = 0;
      playlists[a] = adjusted;
      continue;
    }
    adjusted.track_list_hash = compute_track_list_hash(adjusted.uris);
    const batches = chunk_uris(adjusted.uris || [], SPOTIFY_ADD_TRACKS_MAX).length;
    adjusted.estimated_api_requests = 1 + batches;
    adjusted.valid_uri_count = adjusted.uris.length;
    playlists[a] = adjusted;
    total_valid_uris += adjusted.uris.length;
    total_api_create += 1;
    total_api_add_batches += batches;
  }

  return {
    dry_run: true,
    playlist_count: playlists.length,
    total_valid_uris: total_valid_uris,
    total_invalid_or_excluded: total_invalid,
    estimated_api_requests: total_api_create + total_api_add_batches,
    estimated_create_requests: total_api_create,
    estimated_add_batch_requests: total_api_add_batches,
    playlists: playlists,
    scopes_ok: has_mvp_sync_scopes(),
    missing_scopes: get_mvp_sync_missing_scopes(),
    reauth_hint_zh: mvp_reauth_hint_zh(),
  };
}

/**
 * @param {object} [opts]
 */
export function run_mvp_spotify_sync_dry_run(opts) {
  const options = opts || {};
  const index_doc = load_classification_index_for_mvp(options);
  const catalog = build_mvp_playlist_catalog(index_doc);
  const plan = build_mvp_sync_plan(catalog, index_doc, options);
  const manifest = load_sync_manifest(options.manifest_path);
  plan.existing_manifest_playlists = Object.keys(manifest.playlists || {}).length;
  return plan;
}

/**
 * @param {object} [opts]
 */
export async function run_mvp_spotify_sync_apply(opts) {
  const options = opts || {};
  if (options.authorize !== MVP_SPOTIFY_SYNC_AUTHORIZE_TOKEN) {
    throw new Error(
      '缺少授權旗標：請加上 --authorize=' + MVP_SPOTIFY_SYNC_AUTHORIZE_TOKEN
    );
  }
  if (!has_mvp_sync_scopes()) {
    throw new Error(
      'OAuth scope 不足：' + get_mvp_sync_missing_scopes().join(', ') + '。' + mvp_reauth_hint_zh()
    );
  }

  const plan = run_mvp_spotify_sync_dry_run(options);
  const manifest_path = options.manifest_path || DEFAULT_MVP_SYNC_MANIFEST_PATH;
  let manifest = load_sync_manifest(manifest_path);

  const api_opts = {
    max_rate_retries: typeof options.max_rate_retries === 'number' ? options.max_rate_retries : 3,
    max_retry_after_sec:
      typeof options.max_retry_after_sec === 'number' ? options.max_retry_after_sec : 120,
    skip_global_rate_limit_check: true,
  };

  /** @type {object[]} */
  const results = [];

  for (let i = 0; i < plan.playlists.length; i += 1) {
    const pl = plan.playlists[i];
    if (pl.skip_spotify_writes || pl.skipped_pending_status || pl.skipped_custom) {
      results.push({
        mvp_playlist_id: pl.mvp_playlist_id,
        skipped: true,
        reason: pl.skipped_custom ? 'protected_custom_playlist' : 'pending_absence_status',
        spotify_playlist_id: (manifest.playlists[pl.mvp_playlist_id] && manifest.playlists[pl.mvp_playlist_id].spotify_playlist_id) || null,
      });
      continue;
    }
    let row = manifest.playlists[pl.mvp_playlist_id] || {
      mvp_playlist_id: pl.mvp_playlist_id,
      sync_status: SYNC_STATUS_CREATED,
    };

    try {
      manifest.playlists[pl.mvp_playlist_id] = row;

      const apply_result = await apply_one_mvp_playlist_sync(pl, row, {
        fetch_playlist_track_uris: fetch_playlist_track_uris,
        add_tracks_to_playlist: add_tracks_to_playlist,
        create_private_playlist: create_private_playlist,
        api_opts: api_opts,
        verify_read_attempts:
          typeof options.verify_read_attempts === 'number' ? options.verify_read_attempts : 3,
        verify_delay_ms:
          typeof options.verify_delay_ms === 'number' ? options.verify_delay_ms : 0,
        on_checkpoint: function () {
          manifest.playlists[pl.mvp_playlist_id] = row;
          save_sync_manifest(manifest, manifest_path);
        },
      });

      manifest.playlists[pl.mvp_playlist_id] = row;
      save_sync_manifest(manifest, manifest_path);

      if (apply_result.skipped) {
        results.push({
          mvp_playlist_id: pl.mvp_playlist_id,
          skipped: true,
          reason: apply_result.reason,
          spotify_playlist_id: apply_result.spotify_playlist_id,
        });
        continue;
      }

      results.push({
        mvp_playlist_id: pl.mvp_playlist_id,
        spotify_playlist_id: apply_result.spotify_playlist_id,
        added_uris: apply_result.added_uris,
        to_add_count: apply_result.to_add_count,
        post_attempted: apply_result.post_attempted,
        status: apply_result.status,
        error: apply_result.error,
        verify_missing_count: apply_result.verify_missing_count,
      });
    } catch (err) {
      row.sync_status = map_sync_error_status(err);
      row.last_error = err && err.message ? err.message : String(err);
      if (err instanceof SpotifyRequestError && err.retry_after_sec) {
        row.retry_after_sec = err.retry_after_sec;
      }
      manifest.playlists[pl.mvp_playlist_id] = row;
      save_sync_manifest(manifest, manifest_path);
      results.push({
        mvp_playlist_id: pl.mvp_playlist_id,
        error: row.last_error,
        status: row.sync_status,
      });
      if (err instanceof SpotifyRequestError && err.status === 429) {
        break;
      }
    }
  }

  return {
    applied: true,
    results: results,
    manifest_path: manifest_path,
  };
}
