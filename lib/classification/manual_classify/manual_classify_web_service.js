/**
 * 人工分類 Web UI 服務層（可單元測試，不經 shell）
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  build_manual_classify_plan,
  apply_manual_classify_plan,
} from './manual_classify_core.js';
import { load_manual_overrides } from '../overrides_store.js';
import { load_library_v2_for_probe } from '../../probe/library_v2_select.js';
import { build_classification_index } from '../build_index.js';
import {
  compute_plan_membership_summary,
  count_plan_pending_writes,
  compute_overrides_fingerprint,
  target_playlist_ids_from_plan,
  per_track_membership_detail,
} from './manual_classify_membership_diff.js';
import {
  load_mvp_playlist_registry,
  MVP_SYNC_MANIFEST_PATH,
} from './mvp_playlist_resolver.js';
import { spotify_playlist_display_name } from '../mvp_spotify_playlist_naming.js';
import {
  build_mvp_playlist_catalog,
  load_classification_index_for_mvp,
} from '../mvp_smart_playlists.js';
import { compute_track_list_hash } from '../mvp_playlist_sync.js';
import { build_spotify_classify_input_fields } from './spotify_id_resolve_local.js';
import { sort_playlists_for_ui, group_playlists_for_ui } from './mvp_playlist_ui_sort.js';

/** @type {Set<string>} */
const consumed_apply_tokens = new Set();
/** @type {string|null} */
let apply_inflight_token = null;

const MAX_CONSUMED_TOKENS = 500;

/**
 * @param {object} req
 */
export function build_manual_classify_request_from_ui(req) {
  const body = req || {};
  const fields = build_spotify_classify_input_fields(body);
  /** @type {object} */
  const out = {
    track_tokens: fields.track_tokens || '',
    album: fields.album || null,
    album_ids: fields.album_ids || [],
    playlist_ids: normalize_playlist_id_list(body.playlist_ids),
    spotify_id_kind: body.spotify_id_kind || null,
    spotify_input_resolution: fields.spotify_input_resolution,
    overrides_doc: body.overrides_doc,
    registry_doc: body.registry_doc,
    album_tracks_path: body.album_tracks_path,
    catalog_path: body.catalog_path,
    manifest_path: body.manifest_path,
  };
  return out;
}

/**
 * @param {unknown} raw
 */
function normalize_playlist_id_list(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  /** @type {string[]} */
  const ids = [];
  const seen = {};
  for (let i = 0; i < raw.length; i += 1) {
    const id = String(raw[i] || '').trim();
    if (!id || seen[id]) {
      continue;
    }
    seen[id] = true;
    ids.push(id);
  }
  return ids.sort();
}

/**
 * @param {object} req
 */
export function compute_manual_classify_preview_token(req) {
  const canonical = JSON.stringify({
    spotify_input: typeof req.spotify_input === 'string' ? req.spotify_input.trim() : '',
    spotify_id_kind: req.spotify_id_kind || null,
    playlist_ids: normalize_playlist_id_list(req.playlist_ids),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * @param {object} [opts]
 */
export function list_mvp_playlists_for_ui(opts) {
  const options = opts || {};
  const registry = load_mvp_playlist_registry(options);
  const manifest_path = options.manifest_path || MVP_SYNC_MANIFEST_PATH;
  /** @type {Set<string>} */
  let manifest_ids = null;
  if (options.all_registry_entries !== true && fs.existsSync(manifest_path)) {
    const manifest = JSON.parse(fs.readFileSync(manifest_path, 'utf8'));
    manifest_ids = new Set(Object.keys(manifest.playlists || {}));
  }
  let entry_list = registry.entries || [];
  if (manifest_ids && manifest_ids.size > 0) {
    entry_list = entry_list.filter(function (e) {
      return manifest_ids.has(e.playlist_id);
    });
  }
  /** @type {object[]} */
  const playlists = [];
  for (let i = 0; i < entry_list.length; i += 1) {
    const e = entry_list[i];
    playlists.push({
      playlist_id: e.playlist_id,
      kind: e.kind,
      label_zh: e.label_zh,
      language_bucket: e.language_bucket || null,
      primary_genre: e.primary_genre || null,
      emotion_code: e.emotion_code || null,
      display_title: pick_playlist_display_title(e),
    });
  }
  const sorted = sort_playlists_for_ui(playlists);
  return {
    count: sorted.length,
    playlists: sorted,
    playlist_groups: group_playlists_for_ui(sorted),
  };
}

/**
 * @param {object} entry
 */
function pick_playlist_display_title(entry) {
  const names = entry.display_names || [];
  if (names.length && typeof names[0] === 'string' && names[0].trim()) {
    return names[0].trim();
  }
  if (entry.kind === 'language_genre') {
    return spotify_playlist_display_name({
      kind: 'language_genre',
      language_bucket: entry.language_bucket,
      label_zh: entry.label_zh,
      primary_genre: entry.primary_genre,
    });
  }
  return spotify_playlist_display_name({
    kind: 'emotion_tentative',
    emotion_code: entry.emotion_code,
    label_zh: entry.label_zh,
  });
}

/**
 * @param {object} [opts]
 */
function build_playlist_label_map(opts) {
  const registry = load_mvp_playlist_registry(opts || {});
  /** @type {Record<string, string>} */
  const map = {};
  const entries = registry.entries || [];
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const names = e.display_names || [];
    if (names.length && names[0]) {
      map[e.playlist_id] = String(names[0]).replace(/^\uD83C\uDFB5\s*/, '').replace(/^🎵\s/u, '').trim();
    } else {
      map[e.playlist_id] = e.label_zh || e.playlist_id;
    }
  }
  return map;
}

/**
 * @param {string[]} ids
 * @param {Record<string, string>} label_map
 */
function playlist_ids_to_labels(ids, label_map) {
  /** @type {object[]} */
  const out = [];
  for (let i = 0; i < (ids || []).length; i += 1) {
    const pid = ids[i];
    out.push({
      playlist_id: pid,
      label_zh: label_map[pid] || pid,
    });
  }
  return out;
}

/**
 * @param {string} track_id
 * @param {Record<string, object>} track_index
 */
function library_track_display(track_id, track_index) {
  const row = track_index[track_id];
  if (!row) {
    return {
      track_name: null,
      artists_text: null,
      album_name: null,
      metadata_hint_zh: '不在 library-v2',
    };
  }
  const name = row.name || row.track_name || null;
  let artists_text = null;
  if (Array.isArray(row.artists) && row.artists.length) {
    artists_text = row.artists.join('、');
  } else if (Array.isArray(row.artist_details) && row.artist_details.length) {
    artists_text = row.artist_details
      .map(function (a) {
        return a.name || '';
      })
      .filter(Boolean)
      .join('、');
  }
  const album_name = row.album_name || row.album || null;
  let metadata_hint_zh = null;
  if (!name) {
    metadata_hint_zh = '名稱資料尚未取得';
  }
  return {
    track_name: name,
    artists_text: artists_text,
    album_name: album_name,
    metadata_hint_zh: metadata_hint_zh,
  };
}

/**
 * @param {object} plan
 */
export function format_manual_classify_preview_for_ui(plan) {
  const pr = plan.playlist_resolution || {};
  const library = load_library_v2_for_probe();
  const track_index = library.track_index || {};
  const label_map = build_playlist_label_map();
  const target_playlists = target_playlist_ids_from_plan(plan);
  const summary =
    plan.membership_summary || compute_plan_membership_summary(plan);
  const pending_writes = count_plan_pending_writes(plan);

  /** @type {object[]} */
  const playlists_new = [];
  for (let i = 0; i < (pr.resolved || []).length; i += 1) {
    const r = pr.resolved[i];
    playlists_new.push({
      playlist_id: r.playlist.playlist_id,
      label_zh: label_map[r.playlist.playlist_id] || r.playlist.label_zh,
      kind: r.playlist.kind,
    });
  }
  /** @type {object[]} */
  const tracks = [];
  for (let t = 0; t < (plan.tracks || []).length; t += 1) {
    const row = plan.tracks[t];
    const prev = row.previous_override || {};
    const display = library_track_display(row.track_id, track_index);
    const membership = per_track_membership_detail(row, target_playlists);
    const classification_status =
      membership.pending_playlist_ids.length === 0 && target_playlists.length > 0
        ? 'complete'
        : membership.pending_playlist_ids.length > 0
          ? 'partial'
          : 'none';
    tracks.push({
      track_id: row.track_id,
      in_library: row.in_library,
      changed: row.changed,
      validation_ok: row.validation && row.validation.ok,
      g3_f_registry_status: row.g3_f_registry_status,
      conflicts: row.conflicts || [],
      track_name: display.track_name,
      artists_text: display.artists_text,
      album_name: display.album_name,
      metadata_hint_zh: display.metadata_hint_zh,
      classification_status: classification_status,
      playlists_already: playlist_ids_to_labels(membership.already_target_playlist_ids, label_map),
      playlists_pending: playlist_ids_to_labels(membership.pending_playlist_ids, label_map),
      playlists_other: playlist_ids_to_labels(
        membership.other_mvp_playlist_ids.concat(membership.other_emotion_playlist_ids),
        label_map
      ),
      current_mvp_playlist_ids: prev.mvp_playlist_ids || [],
      current_emotion_playlist_ids: prev.emotion_playlist_ids || [],
      proposed_mvp_playlist_ids: (row.proposed_override && row.proposed_override.mvp_playlist_ids) || [],
      proposed_emotion_playlist_ids:
        (row.proposed_override && row.proposed_override.emotion_playlist_ids) || [],
    });
  }
  /** @type {object|null} */
  let albums = null;
  if (plan.targets && plan.targets.albums && plan.targets.albums.albums) {
    albums = plan.targets.albums.albums.map(function (sec) {
      return {
        album_id: sec.album_id,
        ok: sec.ok,
        incomplete: sec.incomplete,
        error: sec.error || null,
        note_zh: sec.note_zh || null,
        track_count: (sec.track_ids || []).length,
        album_name: sec.album_name || sec.name || null,
      };
    });
  }
  /** @type {object|null} */
  let spotify_input = null;
  if (plan.targets && plan.targets.id_resolution) {
    spotify_input = {
      needs_type_choice: plan.targets.id_resolution.needs_type_choice || [],
      blocked: !!plan.targets.id_resolution.blocked,
    };
  }
  let apply_status_message_zh = '';
  if (!plan.ok) {
    apply_status_message_zh = '無法寫入，請修正阻擋原因。';
  } else if (summary.apply_status === 'complete') {
    apply_status_message_zh = '已完成分類，無須重複寫入。';
  } else if (summary.apply_status === 'partial') {
    apply_status_message_zh = '部分已分類，將僅補缺少的歌單歸屬。';
  } else if (summary.apply_status === 'all_new') {
    apply_status_message_zh = '可確認寫入新的歌單歸屬。';
  }

  const can_apply =
    plan.ok === true &&
    summary.pending_target_slots > 0 &&
    pending_writes > 0;

  return {
    ok: plan.ok,
    can_apply: can_apply,
    mode: 'preview_readonly',
    track_count: tracks.length,
    membership_summary: summary,
    apply_status: summary.apply_status,
    apply_status_message_zh: apply_status_message_zh,
    albums: albums,
    spotify_input: spotify_input,
    playlists_selected: playlists_new,
    playlists_blocked: pr.blocked || [],
    blocked_reasons: plan.blocked_reasons || [],
    album_apply_blocked: plan.album_apply_blocked,
    tracks: tracks,
    note_zh: plan.note_zh,
  };
}

/**
 * @param {object} body
 * @param {object} [opts]
 */
export function run_manual_classify_preview(body, opts) {
  const options = opts || {};
  const req = build_manual_classify_request_from_ui(body);
  const overrides_doc = load_manual_overrides();
  const plan = build_manual_classify_plan(req);
  const preview_token = compute_manual_classify_preview_token(body || {});
  const preview = format_manual_classify_preview_for_ui(plan);
  preview.overrides_fingerprint = compute_overrides_fingerprint(overrides_doc);
  return {
    preview_token: preview_token,
    preview: preview,
    plan_internal: options.include_plan ? plan : undefined,
  };
}

/**
 * @param {object} body
 * @param {object} [opts]
 */
export function run_manual_classify_apply(body, opts) {
  const options = opts || {};
  if (body.confirm !== true) {
    return { ok: false, error: 'confirm_required', message_zh: '套用需明確 confirm: true' };
  }
  const token = typeof body.preview_token === 'string' ? body.preview_token.trim() : '';
  if (!token) {
    return { ok: false, error: 'missing_preview_token' };
  }
  const expected = compute_manual_classify_preview_token(body.request || {});
  if (token !== expected) {
    return { ok: false, error: 'preview_token_mismatch', message_zh: '預覽 token 與請求不一致，請重新預覽。' };
  }
  if (consumed_apply_tokens.has(token)) {
    return { ok: false, error: 'duplicate_apply', message_zh: '此預覽已套用過，請重新預覽後再試。' };
  }
  if (apply_inflight_token && apply_inflight_token !== token) {
    return { ok: false, error: 'apply_in_progress', message_zh: '另一筆套用進行中，請稍後。' };
  }
  apply_inflight_token = token;
  try {
    const fresh_overrides = load_manual_overrides();
    const fresh_fp = compute_overrides_fingerprint(fresh_overrides);
    if (
      body.overrides_fingerprint &&
      typeof body.overrides_fingerprint === 'string' &&
      body.overrides_fingerprint !== fresh_fp
    ) {
      return {
        ok: false,
        error: 'stale_preview',
        message_zh: 'manual-overrides 已變更，請重新預覽後再寫入。',
      };
    }
    const req = build_manual_classify_request_from_ui(body.request || {});
    const plan = build_manual_classify_plan(req);
    if (!plan.ok) {
      return {
        ok: false,
        error: 'plan_not_ok',
        blocked_reasons: plan.blocked_reasons,
        preview: format_manual_classify_preview_for_ui(plan),
      };
    }
    const pending_writes = count_plan_pending_writes(plan);
    const summary = plan.membership_summary || compute_plan_membership_summary(plan);
    if (summary.pending_target_slots === 0 || pending_writes === 0) {
      return {
        ok: true,
        result: 'no_changes',
        writes: 0,
        message_zh: '已完成分類，無須重複寫入。',
        membership_summary: summary,
      };
    }
    const applied = apply_manual_classify_plan(plan, {
      write: options.write !== false,
    });
    if (!applied.ok) {
      return { ok: false, error: applied.error || 'apply_failed', detail: applied };
    }
    if (applied.result === 'no_changes' || applied.writes === 0) {
      return {
        ok: true,
        result: 'no_changes',
        writes: 0,
        message_zh: applied.note_zh || '無須寫入。',
        membership_summary: summary,
      };
    }
    let classify_build = null;
    if (options.write !== false && applied.writes > 0 && options.rebuild_index !== false) {
      classify_build = build_classification_index();
    }
    consumed_apply_tokens.add(token);
    if (consumed_apply_tokens.size > MAX_CONSUMED_TOKENS) {
      const first = consumed_apply_tokens.values().next().value;
      consumed_apply_tokens.delete(first);
    }
    return {
      ok: true,
      writes: applied.writes,
      backup_path: applied.backup_path || null,
      overrides_path: applied.overrides_path || null,
      classify_build_ran: !!classify_build,
      note_zh: applied.note_zh || null,
    };
  } finally {
    apply_inflight_token = null;
  }
}

/** 測試用：清除 token 狀態 */
export function reset_manual_classify_apply_state_for_tests() {
  consumed_apply_tokens.clear();
  apply_inflight_token = null;
}

/** @param {string} token */
export function mark_preview_token_consumed_for_tests(token) {
  consumed_apply_tokens.add(token);
}

/**
 * @param {object} [opts]
 */
export function build_mvp_sync_status_summary_for_ui(opts) {
  const options = opts || {};
  const manifest_path = options.manifest_path || MVP_SYNC_MANIFEST_PATH;
  /** @type {object|null} */
  let manifest = null;
  if (fs.existsSync(manifest_path)) {
    manifest = JSON.parse(fs.readFileSync(manifest_path, 'utf8'));
  }
  const index_doc = load_classification_index_for_mvp(options);
  const catalog = build_mvp_playlist_catalog(index_doc);
  /** @type {Record<string, object>} */
  const catalog_hash_by_id = {};
  const lg = catalog.language_genre_playlists || catalog.genre_playlists || [];
  for (let i = 0; i < lg.length; i += 1) {
    const pl = lg[i];
    const uris = (pl.track_ids || []).map(function (id) {
      return 'spotify:track:' + id;
    });
    catalog_hash_by_id[pl.playlist_id] = {
      valid_uri_count: pl.track_count || pl.track_ids.length,
      track_list_hash: compute_track_list_hash(uris),
    };
  }
  const emo = catalog.emotion_playlists_tentative || [];
  for (let e = 0; e < emo.length; e += 1) {
    const pl = emo[e];
    const uris = (pl.track_ids || []).map(function (id) {
      return 'spotify:track:' + id;
    });
    catalog_hash_by_id[pl.playlist_id] = {
      valid_uri_count: pl.track_count || pl.track_ids.length,
      track_list_hash: compute_track_list_hash(uris),
    };
  }

  /** @type {object[]} */
  const need_sync = [];
  const rows = (manifest && manifest.playlists) || {};
  const keys = Object.keys(rows).sort();
  for (let k = 0; k < keys.length; k += 1) {
    const pid = keys[k];
    const row = rows[pid];
    const cat = catalog_hash_by_id[pid];
    if (!cat) {
      continue;
    }
    const hash_match = row.track_list_hash === cat.track_list_hash;
    const status_complete = row.sync_status === 'complete';
    if (!hash_match || !status_complete) {
      need_sync.push({
        mvp_playlist_id: pid,
        spotify_playlist_id: row.spotify_playlist_id || null,
        sync_status: row.sync_status || null,
        manifest_valid_uri_count: row.valid_uri_count,
        catalog_track_count: cat.valid_uri_count,
        hash_match: hash_match,
        reason_zh: !hash_match
          ? '本機 catalog 與 manifest hash 不一致，建議同步'
          : 'manifest 尚未標記 complete',
      });
    }
  }

  return {
    local_classification_ready: true,
    spotify_sync_via_web_ui: false,
    spotify_sync_cli_hint: 'npm run mvp:spotify-sync（dry-run）／--apply 需 CLI 授權旗標',
    manifest_path: manifest_path,
    playlists_need_sync_count: need_sync.length,
    playlists_need_sync: need_sync,
  };
}

/**
 * 確認回應不含 OAuth／env 敏感鍵
 * @param {unknown} payload
 */
export function response_has_oauth_leak(payload) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  const forbidden = [
    'refresh_token',
    'access_token',
    'client_secret',
    'spotify_client',
    'process.env',
  ];
  for (let i = 0; i < forbidden.length; i += 1) {
    if (text.indexOf(forbidden[i]) >= 0) {
      return true;
    }
  }
  return false;
}
