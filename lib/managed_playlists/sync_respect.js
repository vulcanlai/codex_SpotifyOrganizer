/**
 * 後續 Spotify 同步必須尊重人工調整：名稱鎖定、每歌單移除、自訂歌單不套模板。
 * 不另建第二套分類系統，只過濾既有 catalog／manifest 計畫。
 */
import { KIND_CUSTOM } from './constants.js';
import { load_rules, resolve_paths } from './stores.js';
import { load_sync_manifest } from '../classification/mvp_playlist_sync_manifest.js';
import { is_managed_playlist_name, is_pending_absence_status, is_sync_writable_status } from './identity.js';

export function invert_manifest_spotify_ids(manifest) {
  const map = {};
  const rows = (manifest && manifest.playlists) || {};
  const keys = Object.keys(rows);
  for (let i = 0; i < keys.length; i += 1) {
    const sid = rows[keys[i]] && rows[keys[i]].spotify_playlist_id;
    if (sid) {
      map[sid] = keys[i];
      map[keys[i]] = sid;
    }
  }
  return map;
}

export function rule_for_mvp_playlist(rules, manifest, mvp_playlist_id) {
  const rows = (manifest && manifest.playlists) || {};
  const sid = rows[mvp_playlist_id] && rows[mvp_playlist_id].spotify_playlist_id;
  if (!sid || !rules || !rules.playlists) {
    return null;
  }
  return rules.playlists[sid] || null;
}

/**
 * 同步寫回曲目時：人工移除 > 自動分類補入。
 */
export function filter_uris_by_human_removals(uris, rule) {
  if (!rule || !Array.isArray(rule.removed_track_ids) || !rule.removed_track_ids.length) {
    return uris || [];
  }
  const blocked = new Set(rule.removed_track_ids);
  return (uris || []).filter(function (uri) {
    const id = typeof uri === 'string' && uri.indexOf('spotify:track:') === 0 ? uri.slice('spotify:track:'.length) : uri;
    return !blocked.has(id);
  });
}

/**
 * catalog 建立 membership 時略過該歌單的人工移除曲目。
 */
export function should_skip_auto_membership(rule, track_id) {
  return !!(rule && Array.isArray(rule.removed_track_ids) && rule.removed_track_ids.indexOf(track_id) >= 0);
}

export function resolved_sync_name(auto_name, rule) {
  if (rule && rule.name_locked && rule.retained_name) {
    return rule.retained_name;
  }
  return auto_name;
}

export function should_skip_auto_rename(rule, auto_name) {
  return !!(rule && rule.name_locked && rule.retained_name && rule.retained_name !== auto_name);
}

export function is_protected_custom_playlist(rule) {
  return !!(rule && rule.kind === KIND_CUSTOM);
}

/**
 * 套到 MVP sync plan 的單列。
 */
export function apply_human_rules_to_sync_playlist(pl, rules, manifest) {
  const next = { ...pl };
  const rule = rule_for_mvp_playlist(rules, manifest, pl.mvp_playlist_id);
  if (!rule) {
    return next;
  }
  if (is_protected_custom_playlist(rule) || !is_sync_writable_status(rule.status) || is_pending_absence_status(rule.status)) {
    next.skipped_pending_status = is_pending_absence_status(rule.status);
    next.skipped_custom = is_protected_custom_playlist(rule);
    next.skip_spotify_writes = true;
    next.uris = [];
    next.valid_uri_count = 0;
    next.human_name_locked = rule.name_locked === true;
    next.spotify_name = resolved_sync_name(pl.spotify_name, rule);
    next.human_removed_filtered = (pl.uris || []).length;
    return next;
  }
  next.spotify_name = resolved_sync_name(pl.spotify_name, rule);
  next.uris = filter_uris_by_human_removals(pl.uris, rule);
  next.valid_uri_count = next.uris.length;
  next.human_name_locked = rule.name_locked === true;
  next.human_removed_filtered = (pl.uris || []).length - next.uris.length;
  return next;
}

export function apply_human_rules_to_metadata_change(change, rules) {
  const rule = rules && rules.playlists && rules.playlists[change.spotify_playlist_id];
  if (rule && (is_pending_absence_status(rule.status) || !is_sync_writable_status(rule.status))) {
    return {
      ...change,
      skipped_pending_status: true,
      update_name: false,
      update_description: false,
    };
  }
  if (should_skip_auto_rename(rule, change.target_name)) {
    return {
      ...change,
      skipped_human_name: true,
      target_name: rule.retained_name,
      update_name: false,
    };
  }
  if (
    !rule &&
    change.protect_unconfirmed_live === true &&
    change.current_name &&
    is_managed_playlist_name(change.current_name) &&
    change.current_name !== change.target_name
  ) {
    return {
      ...change,
      skipped_human_name: true,
      skipped_unconfirmed_live_name: true,
      update_name: false,
    };
  }
  return change;
}

export function load_rules_for_sync(options) {
  try {
    return load_rules(options);
  } catch {
    return { playlists: {} };
  }
}

export function load_manifest_for_sync(options) {
  return load_sync_manifest(options && options.manifest_path);
}

export function human_removed_ids_by_mvp_id(options) {
  const paths = options && options.paths ? { paths: options.paths } : options;
  const rules = load_rules_for_sync(paths);
  if (!rules.playlists || !Object.keys(rules.playlists).length) {
    return {};
  }
  const manifest = options && options.manifest ? options.manifest : load_manifest_for_sync(options);
  const out = {};
  const rows = (manifest && manifest.playlists) || {};
  const keys = Object.keys(rows);
  for (let i = 0; i < keys.length; i += 1) {
    const sid = rows[keys[i]].spotify_playlist_id;
    const rule = sid && rules.playlists[sid];
    if (rule && rule.removed_track_ids && rule.removed_track_ids.length) {
      out[keys[i]] = new Set(rule.removed_track_ids);
    }
  }
  return out;
}

export { resolve_paths };
