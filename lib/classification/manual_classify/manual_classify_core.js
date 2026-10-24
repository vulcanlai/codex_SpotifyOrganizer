/**
 * 人工分類：預覽、套用、查詢、撤銷
 */
import fs from 'node:fs';
import path from 'node:path';
import { load_library_v2_for_probe } from '../../probe/library_v2_select.js';
import { build_classification_index } from '../build_index.js';
import { load_g3_f_adopt_registry } from '../g3_f/g3_f_adopt_registry_store.js';
import {
  load_manual_overrides,
  save_manual_overrides,
  empty_overrides_doc,
} from '../overrides_store.js';
import { CLASSIFICATION_DIR, FILE_MANUAL_OVERRIDES } from '../paths.js';
import { LANGUAGE_VALUES } from '../dimensions.js';
import { normalize_genre_profile } from '../genre_profile.js';
import { is_main_genre_code } from '../genre_taxonomy.js';
import { build_mvp_playlist_catalog } from '../mvp_smart_playlists.js';
import {
  parse_spotify_id_list,
  is_valid_spotify_id,
  normalize_spotify_id_token,
} from './spotify_id_parse.js';
import { apply_local_resolution_to_parsed } from './spotify_id_resolve_local.js';
import { resolve_many_albums } from './album_tracks_resolve.js';
import {
  load_mvp_playlist_registry,
  resolve_playlist_queries,
  resolve_playlist_ids,
} from './mvp_playlist_resolver.js';
import {
  merge_track_override_patch,
  validate_manual_classify_patch,
  MANUAL_CLASSIFY_SOURCE,
  build_revoke_patch,
  override_row_semantically_equal,
  dedupe_locked_dimensions,
} from './override_patch.js';
import { compute_plan_membership_summary } from './manual_classify_membership_diff.js';

/**
 * @param {object} input
 */
function collect_album_ids_from_input(input) {
  /** @type {Set<string>} */
  const album_ids = new Set();
  const parsed = parse_spotify_id_list(input.track_tokens || input.tracks || '');
  for (let i = 0; i < parsed.albums.length; i += 1) {
    album_ids.add(parsed.albums[i]);
  }
  const raw_album = input.album || input.album_id || null;
  if (raw_album) {
    add_album_token(String(raw_album), album_ids);
  }
  if (Array.isArray(input.album_ids)) {
    for (let a = 0; a < input.album_ids.length; a += 1) {
      add_album_token(String(input.album_ids[a]), album_ids);
    }
  }
  return { album_ids: Array.from(album_ids).sort(), parse: parsed };
}

/**
 * @param {string} raw
 * @param {Set<string>} album_ids
 */
function add_album_token(raw, album_ids) {
  const token = normalize_spotify_id_token(raw.trim());
  if (token && token.kind === 'album') {
    album_ids.add(token.id);
    return;
  }
  if (token && token.kind === 'unknown' && is_valid_spotify_id(token.id)) {
    album_ids.add(token.id);
    return;
  }
  if (is_valid_spotify_id(raw.trim())) {
    album_ids.add(raw.trim());
  }
}

export function resolve_target_track_ids(input) {
  const collected = collect_album_ids_from_input(input);
  const parsed = collected.parse;
  const resolution = apply_local_resolution_to_parsed(parsed, input || {});
  if (resolution.needs_type_choice.length > 0) {
    return {
      track_ids: [],
      parse: parsed,
      albums: null,
      album_ids_requested: collected.album_ids,
      id_resolution: {
        blocked: true,
        needs_type_choice: resolution.needs_type_choice,
      },
    };
  }
  /** @type {Set<string>} */
  const track_set = new Set(resolution.tracks);
  /** @type {Set<string>} */
  const album_id_set = new Set(collected.album_ids);
  for (let a = 0; a < resolution.albums.length; a += 1) {
    album_id_set.add(resolution.albums[a]);
  }
  if (Array.isArray(input.album_ids)) {
    for (let b = 0; b < input.album_ids.length; b += 1) {
      album_id_set.add(input.album_ids[b]);
    }
  }
  const album_ids_merged = Array.from(album_id_set).sort();
  let album_summary = null;
  if (album_ids_merged.length) {
    album_summary = resolve_many_albums(album_ids_merged, input);
    for (let i = 0; i < album_summary.track_ids.length; i += 1) {
      track_set.add(album_summary.track_ids[i]);
    }
  }
  return {
    track_ids: Array.from(track_set).sort(),
    parse: parsed,
    albums: album_summary,
    album_ids_requested: album_ids_merged,
    id_resolution: {
      blocked: false,
      resolved_unknown: resolution.resolved_unknown,
    },
  };
}

/**
 * @param {object|null} album_summary
 */
export function album_blocks_manual_classify_apply(album_summary) {
  if (!album_summary || !album_summary.albums) {
    return { blocked: false, reasons: [] };
  }
  /** @type {string[]} */
  const reasons = [];
  const sections = album_summary.albums;
  for (let i = 0; i < sections.length; i += 1) {
    const sec = sections[i];
    if (sec.incomplete) {
      reasons.push(
        '專輯 ' +
          sec.album_id +
          ' 曲目清單不完整（incomplete）；拒絕整張專輯正式套用。'
      );
    }
    if (sec.error === 'album_read_incomplete' || sec.error === 'album_not_in_local_cache') {
      reasons.push(
        '專輯 ' + sec.album_id + '：' + (sec.note_zh || sec.error)
      );
    }
    if (!sec.ok && sec.error && sec.track_ids.length === 0) {
      reasons.push('專輯 ' + sec.album_id + ' 無可用曲目：' + sec.error);
    }
  }
  return { blocked: reasons.length > 0, reasons: reasons };
}

/**
 * @param {object} req
 */
export function build_manual_classify_plan(req) {
  const options = req || {};
  const targets = resolve_target_track_ids(options);
  const library = load_library_v2_for_probe();
  const track_index = library.track_index || {};
  const overrides_doc = options.overrides_doc || load_manual_overrides();
  const registry_doc = options.registry_doc || load_g3_f_adopt_registry();
  const registry_by_id = registry_doc.adoptions_by_track_id || {};

  const registry_playlists = load_mvp_playlist_registry(options);
  /** @type {object} */
  let playlist_resolved;
  if (Array.isArray(options.playlist_ids) && options.playlist_ids.length) {
    playlist_resolved = resolve_playlist_ids(options.playlist_ids, registry_playlists);
  } else {
    const playlist_queries = split_query_list(options.playlists || options.playlist || '');
    playlist_resolved = resolve_playlist_queries(playlist_queries, registry_playlists, {
      language_bucket: options.language_bucket || null,
    });
  }

  /** @type {object|null} */
  let genre_profile = null;
  if (options.primary_genre || options.genre_primary) {
    const code = options.primary_genre || options.genre_primary;
    genre_profile = normalize_genre_profile({
      primary_genre: code,
      secondary_genres: options.secondary_genres || options.secondary || [],
      subgenres: options.subgenres || [],
    });
  } else if (options.genre_profile) {
    genre_profile = normalize_genre_profile(options.genre_profile);
  }

  const language = options.language || null;
  const contexts = split_query_list(options.contexts || options.context || '');

  /** @type {object} */
  const shared_patch = {
    source: MANUAL_CLASSIFY_SOURCE,
  };
  /** @type {string[]} */
  const locked = [];
  if (language) {
    shared_patch.language = language;
    locked.push('language');
  }
  if (genre_profile) {
    shared_patch.genre_profile = genre_profile;
    locked.push('genre_profile');
  }
  if (contexts.length) {
    shared_patch.contexts = contexts;
    locked.push('context');
  }
  if (playlist_resolved.mvp_playlist_ids.length) {
    shared_patch.mvp_playlist_ids = playlist_resolved.mvp_playlist_ids;
    locked.push('mvp_playlists');
  }
  if (playlist_resolved.emotion_playlist_ids.length) {
    shared_patch.emotion_playlist_ids = playlist_resolved.emotion_playlist_ids;
    locked.push('emotion_playlists');
  }
  if (options.note_zh) {
    shared_patch.note_zh = options.note_zh;
  }
  if (locked.length) {
    shared_patch.locked_dimensions = dedupe_locked_dimensions(locked);
  }

  const patch_validation = validate_manual_classify_patch(shared_patch);

  /** @type {object[]} */
  const per_track = [];
  for (let i = 0; i < targets.track_ids.length; i += 1) {
    const tid = targets.track_ids[i];
    const in_library = !!track_index[tid];
    const prev = overrides_doc.overrides_by_track_id[tid] || null;
    const merged = merge_track_override_patch(prev, shared_patch);
    const merged_validation = validate_manual_classify_patch(merged);
    const registry_entry = registry_by_id[tid] || null;
    /** @type {string[]} */
    const conflicts = [];
    if (
      registry_entry &&
      registry_entry.status === 'adopted' &&
      shared_patch.genre_profile
    ) {
      conflicts.push('g3_f_adopt_registry 仍保留；人工 genre_profile 優先於 registry 有效分類。');
    }
    const changed = !prev || !override_row_semantically_equal(prev, merged);
    per_track.push({
      track_id: tid,
      in_library: in_library,
      metadata_missing: in_library ? !track_index[tid].name : null,
      previous_override: prev,
      proposed_override: merged,
      changed: changed,
      validation: merged_validation,
      g3_f_registry_status: registry_entry ? registry_entry.status : null,
      conflicts: conflicts,
    });
  }

  const preview_index = build_classification_index({
    write: false,
    overrides_doc: simulate_overrides_after_plan(overrides_doc, per_track),
  });
  const catalog_after = build_mvp_playlist_catalog(preview_index.index_doc);
  const album_gate = album_blocks_manual_classify_apply(targets.albums);

  /** @type {object} */
  const plan = {
    ok:
      patch_validation.ok &&
      playlist_resolved.ok &&
      targets.track_ids.length > 0 &&
      !(targets.id_resolution && targets.id_resolution.blocked) &&
      !album_gate.blocked &&
      per_track.every(function (t) {
        return t.validation.ok;
      }),
    mode: 'dry_run',
    targets: targets,
    playlist_resolution: playlist_resolved,
    shared_patch: shared_patch,
    shared_patch_validation: patch_validation,
    tracks: per_track,
    album_apply_blocked: album_gate.blocked,
    blocked_reasons: collect_blocked_reasons(
      targets,
      playlist_resolved,
      patch_validation,
      album_gate
    ),
    catalog_playlist_count: (catalog_after.language_genre_playlists || []).length,
    note_zh:
      '預設為 dry-run；僅 --apply --confirm 會寫入 manual-overrides.json（寫入前自動備份）。',
  };
  plan.membership_summary = compute_plan_membership_summary(plan);
  return plan;
}

function simulate_overrides_after_plan(overrides_doc, per_track) {
  const doc = {
    schema_version: overrides_doc.schema_version,
    updated_at: overrides_doc.updated_at,
    overrides_by_track_id: { ...overrides_doc.overrides_by_track_id },
  };
  for (let i = 0; i < per_track.length; i += 1) {
    const row = per_track[i];
    if (row.changed && row.validation.ok) {
      doc.overrides_by_track_id[row.track_id] = row.proposed_override;
    }
  }
  return doc;
}

function collect_blocked_reasons(targets, playlist_resolved, patch_validation, album_gate) {
  /** @type {string[]} */
  const reasons = [];
  if (album_gate && album_gate.blocked) {
    for (let r = 0; r < album_gate.reasons.length; r += 1) {
      reasons.push(album_gate.reasons[r]);
    }
  }
  if (targets.id_resolution && targets.id_resolution.blocked) {
    for (let n = 0; n < (targets.id_resolution.needs_type_choice || []).length; n += 1) {
      const row = targets.id_resolution.needs_type_choice[n];
      reasons.push(
        '純 ID ' +
          row.id +
          '：' +
          (row.reason_zh || '請指定 Track／Album 或使用完整 Spotify URL')
      );
    }
  }
  if (!targets.track_ids.length) {
    reasons.push('未解析到任何 track_id');
  }
  if (targets.parse.invalid_tokens.length) {
    reasons.push('無效 token：' + targets.parse.invalid_tokens.join(', '));
  }
  if (!playlist_resolved.ok) {
    reasons.push('部分歌單名稱無法唯一解析（ambiguous／none）');
  }
  if (!patch_validation.ok) {
    reasons.push('patch 驗證失敗：' + patch_validation.errors.join('；'));
  }
  return reasons;
}

function split_query_list(raw) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.filter(Boolean);
  }
  return String(raw)
    .split(/[,，;；\n]/)
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
}

/**
 * @param {object} plan
 * @param {object} [opts]
 */
export function apply_manual_classify_plan(plan, opts) {
  const options = opts || {};
  if (!plan || !plan.tracks) {
    return { ok: false, error: 'invalid_plan' };
  }
  if (plan.album_apply_blocked) {
    return {
      ok: false,
      error: 'album_apply_blocked',
      blocked: plan.blocked_reasons,
    };
  }
  if (!plan.ok && !options.force) {
    return { ok: false, error: 'plan_not_ok', blocked: plan.blocked_reasons };
  }
  const overrides_doc = options.overrides_doc || load_manual_overrides();
  let writes = 0;
  for (let i = 0; i < plan.tracks.length; i += 1) {
    const row = plan.tracks[i];
    if (!row.in_library) {
      continue;
    }
    if (!row.validation.ok) {
      continue;
    }
    if (!row.changed) {
      continue;
    }
    overrides_doc.overrides_by_track_id[row.track_id] = row.proposed_override;
    writes += 1;
  }
  if (writes === 0) {
    return {
      ok: true,
      writes: 0,
      result: 'no_changes',
      note_zh: '無需寫入（目標歌單歸屬已齊或無有效曲目）。',
    };
  }
  let backup_path = null;
  if (options.write !== false) {
    backup_path = backup_manual_overrides_file();
    save_manual_overrides(overrides_doc);
  }
  return {
    ok: true,
    writes: writes,
    backup_path: backup_path,
    overrides_path: FILE_MANUAL_OVERRIDES,
  };
}

export function backup_manual_overrides_file() {
  const backup_dir = path.join(CLASSIFICATION_DIR, 'backups');
  if (!fs.existsSync(backup_dir)) {
    fs.mkdirSync(backup_dir, { recursive: true });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backup_dir, 'manual-overrides-' + stamp + '.json');
  if (fs.existsSync(FILE_MANUAL_OVERRIDES)) {
    fs.copyFileSync(FILE_MANUAL_OVERRIDES, dest);
  } else {
    fs.writeFileSync(dest, JSON.stringify(empty_overrides_doc(), null, 2) + '\n', 'utf8');
  }
  return dest;
}

/**
 * @param {string} track_id
 * @param {object} [opts]
 */
export function show_manual_classification(track_id, opts) {
  if (!is_valid_spotify_id(track_id)) {
    return { ok: false, error: 'invalid_track_id' };
  }
  const overrides_doc = load_manual_overrides();
  const override_row = overrides_doc.overrides_by_track_id[track_id] || null;
  const built = build_classification_index({ write: false });
  const index_row = built.index_doc.tracks_by_id[track_id] || null;
  const registry = load_g3_f_adopt_registry();
  const reg = registry.adoptions_by_track_id[track_id] || null;
  return {
    ok: true,
    track_id: track_id,
    in_library: !!index_row,
    metadata_status: index_row ? index_row.metadata_status : null,
    manual_override: override_row,
    effective_genre_profile: index_row ? index_row.genre_profile : null,
    manual_playlist_membership: index_row ? index_row.manual_playlist_membership : null,
    g3_f_registry: reg,
  };
}

/**
 * @param {string} track_id
 * @param {object} [opts]
 */
export function revoke_manual_classification(track_id, opts) {
  const options = opts || {};
  const field_group = options.field || options.fields || 'all';
  if (!is_valid_spotify_id(track_id)) {
    return { ok: false, error: 'invalid_track_id' };
  }
  const overrides_doc = load_manual_overrides();
  const prev = overrides_doc.overrides_by_track_id[track_id] || null;
  const revoke = build_revoke_patch(prev, field_group);
  if (revoke.action === 'noop') {
    return { ok: true, changed: false, note_zh: revoke.reason_zh };
  }
  const backup_path =
    options.write !== false ? backup_manual_overrides_file() : null;
  if (revoke.action === 'clear_row') {
    delete overrides_doc.overrides_by_track_id[track_id];
  } else if (revoke.action === 'replace_row') {
    overrides_doc.overrides_by_track_id[track_id] = revoke.row;
  }
  if (options.write !== false) {
    save_manual_overrides(overrides_doc);
  }
  return {
    ok: true,
    changed: true,
    backup_path: backup_path,
    previous: prev,
    field_group: field_group,
  };
}

/**
 * CLI 參數驗證輔助
 * @param {object} args
 */
export function validate_cli_genre_language_args(args) {
  /** @type {string[]} */
  const errors = [];
  if (args.language && LANGUAGE_VALUES.indexOf(args.language) < 0) {
    errors.push('--language 必須為 dimensions 允許值');
  }
  if (args.primary_genre && !is_main_genre_code(args.primary_genre)) {
    errors.push('--primary-genre 非法主曲風 code');
  }
  return errors;
}
