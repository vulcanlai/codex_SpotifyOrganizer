/**
 * 僅更新 manifest 已建立之 Spotify 歌單名稱／描述（不碰曲目）
 */
import {
  load_sync_manifest,
  save_sync_manifest,
  DEFAULT_MVP_SYNC_MANIFEST_PATH,
} from './mvp_playlist_sync_manifest.js';
import {
  build_mvp_playlist_catalog,
  load_classification_index_for_mvp,
  find_mvp_playlist_in_catalog,
} from './mvp_smart_playlists.js';
import {
  spotify_playlist_display_name,
  mvp_sync_playlist_description_zh,
} from './mvp_spotify_playlist_naming.js';
import {
  has_mvp_sync_scopes,
  get_mvp_sync_missing_scopes,
  mvp_reauth_hint_zh,
} from '../auth/mvp_sync_scopes.js';
import { update_playlist_details } from '../spotify_playlists_write.js';
import { SpotifyRequestError } from '../spotify_api.js';

export const MVP_SPOTIFY_METADATA_SYNC_AUTHORIZE_TOKEN =
  'I_UNDERSTAND_MVP_SPOTIFY_METADATA_SYNC';

export const MVP_EMOTION_PLAYLIST_ID_PREFIX = 'emotion:';

/**
 * @param {string} mvp_playlist_id
 * @param {object} options
 */
export function metadata_sync_includes_playlist_row(mvp_playlist_id, options) {
  const opts = options || {};
  if (opts.playlist_id && mvp_playlist_id !== opts.playlist_id) {
    return false;
  }
  if (opts.emotion_only === true) {
    return mvp_playlist_id.indexOf(MVP_EMOTION_PLAYLIST_ID_PREFIX) === 0;
  }
  return true;
}

/**
 * @param {object} manifest_row
 * @param {object} catalog_pl
 */
export function mvp_metadata_targets_for_playlist(manifest_row, catalog_pl) {
  if (!catalog_pl) {
    return null;
  }
  return {
    target_name: spotify_playlist_display_name(catalog_pl),
    target_description: mvp_sync_playlist_description_zh(catalog_pl),
  };
}

/**
 * @param {object} [opts]
 */
export function build_mvp_metadata_update_plan(opts) {
  const options = opts || {};
  const manifest = load_sync_manifest(options.manifest_path);
  const index_doc =
    options.index_doc || load_classification_index_for_mvp(options);
  const catalog = build_mvp_playlist_catalog(index_doc);
  const names_only = options.names_only === true;

  /** @type {object[]} */
  const changes = [];
  /** @type {object[]} */
  const skipped = [];

  const rows = manifest.playlists || {};
  const keys = Object.keys(rows).sort();
  for (let i = 0; i < keys.length; i += 1) {
    const mvp_playlist_id = keys[i];
    if (!metadata_sync_includes_playlist_row(mvp_playlist_id, options)) {
      continue;
    }
    const row = rows[mvp_playlist_id];
    if (!row || !row.spotify_playlist_id) {
      skipped.push({
        mvp_playlist_id: mvp_playlist_id,
        reason: 'no_spotify_playlist_id',
      });
      continue;
    }

    const catalog_pl = find_mvp_playlist_in_catalog(catalog, mvp_playlist_id);
    const targets = mvp_metadata_targets_for_playlist(row, catalog_pl);
    if (!targets) {
      skipped.push({
        mvp_playlist_id: mvp_playlist_id,
        reason: 'not_in_catalog',
      });
      continue;
    }

    const current_name =
      typeof row.spotify_name === 'string' ? row.spotify_name : '';
    const current_description =
      typeof row.spotify_description === 'string' ? row.spotify_description : '';

    const name_will_change = current_name !== targets.target_name;
    let description_will_change =
      current_description !== targets.target_description;
    if (names_only) {
      description_will_change = false;
    }

    if (!name_will_change && !description_will_change) {
      skipped.push({
        mvp_playlist_id: mvp_playlist_id,
        reason: 'already_up_to_date',
      });
      continue;
    }

    changes.push({
      mvp_playlist_id: mvp_playlist_id,
      spotify_playlist_id: row.spotify_playlist_id,
      current_name: current_name,
      target_name: targets.target_name,
      current_description: current_description,
      target_description: targets.target_description,
      update_name: name_will_change,
      update_description: description_will_change,
    });
  }

  return {
    dry_run: true,
    names_only: names_only,
    emotion_only: options.emotion_only === true,
    manifest_playlist_rows: keys.length,
    change_count: changes.length,
    name_change_count: changes.filter(function (c) {
      return c.update_name;
    }).length,
    description_change_count: changes.filter(function (c) {
      return c.update_description;
    }).length,
    estimated_api_requests: changes.length,
    changes: changes,
    skipped: skipped,
    scopes_ok: has_mvp_sync_scopes(),
    missing_scopes: get_mvp_sync_missing_scopes(),
    reauth_hint_zh: mvp_reauth_hint_zh(),
  };
}

/**
 * API 已成功但 manifest 未寫入時：僅本機對齊（不呼叫 Spotify）
 * 使用前請在 Spotify App 確認線上名稱已符合 target_name。
 * @param {object} [opts]
 */
export function run_mvp_metadata_manifest_reconcile(opts) {
  const options = opts || {};
  if (options.authorize !== MVP_SPOTIFY_METADATA_SYNC_AUTHORIZE_TOKEN) {
    throw new Error(
      '缺少授權旗標：請加上 --authorize=' +
        MVP_SPOTIFY_METADATA_SYNC_AUTHORIZE_TOKEN
    );
  }
  const plan = build_mvp_metadata_update_plan(options);
  const manifest_path = options.manifest_path || DEFAULT_MVP_SYNC_MANIFEST_PATH;
  let manifest = load_sync_manifest(manifest_path);
  /** @type {object[]} */
  const results = [];

  for (let i = 0; i < plan.changes.length; i += 1) {
    const ch = plan.changes[i];
    const row = manifest.playlists[ch.mvp_playlist_id];
    if (!row || row.spotify_playlist_id !== ch.spotify_playlist_id) {
      results.push({
        mvp_playlist_id: ch.mvp_playlist_id,
        status: 'skipped',
        error: 'manifest 與計畫不一致',
      });
      continue;
    }
    if (ch.update_name) {
      row.spotify_name = ch.target_name;
      row.catalog_display_name = ch.target_name;
    }
    if (ch.update_description) {
      row.spotify_description = ch.target_description;
    }
    row.metadata_updated_at = new Date().toISOString();
    row.metadata_reconciled_locally_at = new Date().toISOString();
    manifest.playlists[ch.mvp_playlist_id] = row;
    results.push({
      mvp_playlist_id: ch.mvp_playlist_id,
      spotify_playlist_id: row.spotify_playlist_id,
      status: 'reconciled_local',
      name: row.spotify_name,
    });
  }
  save_sync_manifest(manifest, manifest_path);
  return {
    manifest_reconcile_only: true,
    change_count: plan.change_count,
    results: results,
    manifest_path: manifest_path,
  };
}

/**
 * @param {object} [opts]
 */
export async function run_mvp_metadata_update_apply(opts) {
  const options = opts || {};
  if (options.authorize !== MVP_SPOTIFY_METADATA_SYNC_AUTHORIZE_TOKEN) {
    throw new Error(
      '缺少授權旗標：請加上 --authorize=' +
        MVP_SPOTIFY_METADATA_SYNC_AUTHORIZE_TOKEN
    );
  }
  if (!has_mvp_sync_scopes()) {
    throw new Error(
      'OAuth scope 不足：' +
        get_mvp_sync_missing_scopes().join(', ') +
        '。' +
        mvp_reauth_hint_zh()
    );
  }

  const plan = build_mvp_metadata_update_plan(options);
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

  for (let i = 0; i < plan.changes.length; i += 1) {
    const ch = plan.changes[i];
    const row = manifest.playlists[ch.mvp_playlist_id];
    if (!row || row.spotify_playlist_id !== ch.spotify_playlist_id) {
      results.push({
        mvp_playlist_id: ch.mvp_playlist_id,
        error: 'manifest 與計畫不一致，已略過。',
        status: 'skipped',
      });
      continue;
    }

    try {
      const body = {};
      if (ch.update_name) {
        body.name = ch.target_name;
      }
      if (ch.update_description) {
        body.description = ch.target_description;
      }
      const updated = await update_playlist_details(row.spotify_playlist_id, body, api_opts);

      row.spotify_name = updated.name != null ? updated.name : ch.target_name;
      if (ch.update_description) {
        row.spotify_description = ch.target_description;
      }
      row.catalog_display_name = ch.target_name;
      row.metadata_updated_at = new Date().toISOString();
      manifest.playlists[ch.mvp_playlist_id] = row;
      save_sync_manifest(manifest, manifest_path);

      results.push({
        mvp_playlist_id: ch.mvp_playlist_id,
        spotify_playlist_id: row.spotify_playlist_id,
        status: 'updated',
        name: row.spotify_name,
        api_response_empty: updated.api_response_empty === true,
      });
    } catch (err) {
      results.push({
        mvp_playlist_id: ch.mvp_playlist_id,
        spotify_playlist_id: row.spotify_playlist_id,
        error: err && err.message ? err.message : String(err),
        status:
          err instanceof SpotifyRequestError && err.status === 429
            ? 'interrupted'
            : 'failed',
      });
      if (err instanceof SpotifyRequestError && err.status === 429) {
        break;
      }
    }
  }

  return {
    applied: true,
    change_count: plan.change_count,
    results: results,
    manifest_path: manifest_path,
  };
}
