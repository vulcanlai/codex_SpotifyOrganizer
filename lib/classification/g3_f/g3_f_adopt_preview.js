/**
 * G3-F staged → 正式採用「預覽」（僅 dry-run，禁止寫入 index／overrides／staged）
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CLASSIFICATION_DIR,
  FILE_CLASSIFICATION_INDEX,
  FILE_MANUAL_OVERRIDES,
  FILE_AI_REVIEW,
  FILE_AI_REVIEW_V2,
} from '../paths.js';
import { empty_overrides_doc } from '../overrides_store.js';
import { apply_manual_overrides_to_tags } from '../apply_overrides.js';
import { manual_override_blocks_g3_f_genre_adopt } from './manual_override_adopt_guard.js';
import {
  normalize_genre_profile,
  validate_genre_profile,
  build_track_genre_profile,
} from '../genre_profile.js';
import { validate_primary_subgenres } from '../g3_b/genre_subgenre_validate.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import {
  DIMENSION_LANGUAGE,
  DIMENSION_CONTEXT,
  DIMENSION_SPECIAL,
  LANGUAGE_VALUES,
} from '../dimensions.js';
import { resolve_formal_classification_state } from '../classification_state.js';
import { resolve_human_confirmation } from '../g3_evidence/human_confirmation.js';

/** 固定來源標記（冪等、可追溯） */
export const G3_F_ADOPT_PREVIEW_SOURCE = 'g3_f_adopt_preview:dry-run:v1';

/** 硬編碼排除（與 backlog 草稿一致） */
export const G3_F_ADOPT_EXCLUDE_OST = [
  '0QiRfeAOkRKSLBc2xaL0ed',
  '5kP9shSE8aF7QK2RECJU5w',
  '5SCGNXCLKWcACSh8wE8oAV',
];

export const G3_F_ADOPT_EXCLUDE_LOW_DRAFT = [
  '2O8LyIie6tOUSh5qa4M32P',
  '1pW0eUfuie04GXglQZLvsr',
  '5iqRUZDuGS18EjjWc7IO1g',
];

const AI_REVIEW_EXCLUDE_STATUSES = new Set([
  'pending',
  'accepted',
  'modified',
  'rejected',
]);

function read_json_safe(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function parse_wave_number(dir_name) {
  const m = /^g3-f(\d+)-wave-/.exec(dir_name);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * 掃描 g3-f wave 目錄下 staged-candidates（去重：保留 wave 編號最大者）
 * @returns {Map<string, object>}
 */
export function load_deduped_g3_f_staged_map() {
  /** @type {Map<string, object>} */
  const by_id = new Map();
  const dirs = fs.readdirSync(CLASSIFICATION_DIR).filter(function (d) {
    return /^g3-f\d+-wave-/.test(d);
  });
  for (let i = 0; i < dirs.length; i += 1) {
    const wave_dir = dirs[i];
    const wave_number = parse_wave_number(wave_dir);
    const staged_dir = path.join(CLASSIFICATION_DIR, wave_dir, 'staged-candidates');
    if (!fs.existsSync(staged_dir)) {
      continue;
    }
    const files = fs.readdirSync(staged_dir).filter(function (f) {
      return f.endsWith('-staged.json');
    });
    for (let f = 0; f < files.length; f += 1) {
      const doc = JSON.parse(
        fs.readFileSync(path.join(staged_dir, files[f]), 'utf8')
      );
      const id = doc.track_id;
      const prev = by_id.get(id);
      if (!prev || wave_number >= prev.wave_number) {
        by_id.set(id, {
          track_id: id,
          wave_id: wave_dir,
          wave_number: wave_number,
          batch_id: doc.batch_id,
          staged_path: path
            .join(wave_dir, 'staged-candidates', files[f])
            .replace(/\\/g, '/'),
          inference: doc.inference,
        });
      }
    }
  }
  return by_id;
}

function load_ai_review_status_by_id() {
  /** @type {Record<string, string>} */
  const out = {};
  const paths = [FILE_AI_REVIEW_V2, FILE_AI_REVIEW];
  for (let i = 0; i < paths.length; i += 1) {
    const doc = read_json_safe(paths[i]);
    if (!doc || !doc.reviews_by_track_id) {
      continue;
    }
    const keys = Object.keys(doc.reviews_by_track_id);
    for (let k = 0; k < keys.length; k += 1) {
      const id = keys[k];
      const st = doc.reviews_by_track_id[id].status;
      if (st) {
        out[id] = st;
      }
    }
  }
  return out;
}

function special_types_to_strings(special_types) {
  if (!Array.isArray(special_types)) {
    return [];
  }
  const out = [];
  for (let i = 0; i < special_types.length; i += 1) {
    const item = special_types[i];
    if (typeof item === 'string') {
      out.push(item);
    } else if (item && typeof item.value === 'string') {
      out.push(item.value);
    }
  }
  return out;
}

function contexts_to_strings(contexts) {
  if (!Array.isArray(contexts)) {
    return [];
  }
  const out = [];
  for (let i = 0; i < contexts.length; i += 1) {
    const item = contexts[i];
    if (typeof item === 'string') {
      out.push(item);
    } else if (item && typeof item.value === 'string') {
      out.push(item.value);
    }
  }
  return out;
}

/**
 * 自 staged inference 建議 override patch（不補缺欄位）
 * @param {object} inference
 * @param {string} adopt_source
 */
export function inference_to_adopt_patch(inference, adopt_source) {
  const inf = inference || {};
  const gp_raw = inf.genre_profile || {};
  const patch = {
    source: adopt_source,
    genre_profile: {
      primary_genre: gp_raw.primary_genre,
      subgenres: Array.isArray(gp_raw.subgenres) ? gp_raw.subgenres.slice() : [],
      secondary_genres: Array.isArray(gp_raw.secondary_genres)
        ? gp_raw.secondary_genres.slice()
        : [],
    },
  };
  const lang = inf.language && inf.language.value;
  if (typeof lang === 'string' && lang.length) {
    patch.language = lang;
  }
  const ctx = contexts_to_strings(inf.contexts);
  if (ctx.length) {
    patch.contexts = ctx;
  }
  const st = special_types_to_strings(inf.special_types);
  if (st.length) {
    patch.special_types = st;
  }
  return patch;
}

function tag_values(tags, dimension) {
  const out = [];
  for (let i = 0; i < (tags || []).length; i += 1) {
    if (tags[i].dimension === dimension) {
      out.push(tags[i].value);
    }
  }
  return out;
}

function classification_snapshot_from_index_row(row) {
  if (!row) {
    return null;
  }
  const gp = row.genre_profile || {};
  return {
    primary_genre: gp.primary_genre || GENRE_PRIMARY_UNKNOWN,
    subgenres: gp.subgenres || [],
    secondary_genres: gp.secondary_genres || [],
    language: tag_values(row.tags, DIMENSION_LANGUAGE)[0] || '未確認',
    contexts: tag_values(row.tags, DIMENSION_CONTEXT),
    special_types: tag_values(row.tags, DIMENSION_SPECIAL),
    genre_profile_source: gp.source || null,
  };
}

function classification_snapshot_after_override(row, override_patch) {
  if (!row) {
    return null;
  }
  const tags = apply_manual_overrides_to_tags(
    (row.tags || []).slice(),
    override_patch
  );
  const gp = build_track_genre_profile(tags, override_patch);
  return {
    primary_genre: gp.primary_genre || GENRE_PRIMARY_UNKNOWN,
    subgenres: gp.subgenres || [],
    secondary_genres: gp.secondary_genres || [],
    language: tag_values(tags, DIMENSION_LANGUAGE)[0] || '未確認',
    contexts: tag_values(tags, DIMENSION_CONTEXT),
    special_types: tag_values(tags, DIMENSION_SPECIAL),
    genre_profile_source: gp.source || null,
    genre_profile_confidence: gp.confidence || null,
  };
}

function diff_snapshots(before, after) {
  /** @type {string[]} */
  const changed_fields = [];
  if (!before || !after) {
    return { changed_fields: ['missing_index_row'], before, after };
  }
  const keys = [
    'primary_genre',
    'subgenres',
    'secondary_genres',
    'language',
    'contexts',
    'special_types',
  ];
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      changed_fields.push(k);
    }
  }
  return { changed_fields: changed_fields, before: before, after: after };
}

function validate_adopt_patch(patch) {
  const gp = normalize_genre_profile(patch.genre_profile);
  const gp_errors = validate_genre_profile(gp);
  const sub = validate_primary_subgenres(gp.primary_genre, gp.subgenres || []);
  const lang_ok =
    patch.language == null || LANGUAGE_VALUES.indexOf(patch.language) >= 0;
  return {
    ok:
      gp_errors.length === 0 &&
      sub.ok &&
      lang_ok &&
      gp.primary_genre !== GENRE_PRIMARY_UNKNOWN,
    genre_profile_errors: gp_errors,
    subgenre_check: sub,
    language_ok: lang_ok,
    normalized_genre_profile: gp,
  };
}

/**
 * @param {object} [opts]
 */
export function run_g3_f_adopt_preview(opts) {
  const options = opts || {};
  const batch_size = options.batch_size != null ? options.batch_size : 10;
  const batch_index = options.batch_index != null ? options.batch_index : 0;
  const adopt_source = options.adopt_source || G3_F_ADOPT_PREVIEW_SOURCE;
  const write_reports = options.write_reports !== false;
  const output_dir =
    options.output_dir ||
    path.join(
      options.project_root || process.cwd(),
      'reports',
      'g3-f-adopt-preview',
      'dry-run-v1'
    );

  const staged_map = load_deduped_g3_f_staged_map();
  const index_doc = read_json_safe(FILE_CLASSIFICATION_INDEX);
  const overrides_doc = read_json_safe(FILE_MANUAL_OVERRIDES) || empty_overrides_doc();
  const ai_review = load_ai_review_status_by_id();

  const exclude_ost = new Set(G3_F_ADOPT_EXCLUDE_OST);
  const exclude_low_draft = new Set(G3_F_ADOPT_EXCLUDE_LOW_DRAFT);

  /** @type {Record<string, number>} */
  const exclusion_counts = {
    total_staged_deduped: staged_map.size,
    not_high_tier: 0,
    primary_unknown: 0,
    human_locked: 0,
    manual_override_blocks_genre: 0,
    ai_review_any: 0,
    low_tier_blocklist: 0,
    ost_draft_blocklist: 0,
    low_correction_draft_blocklist: 0,
    schema_invalid: 0,
    eligible: 0,
  };

  /** @type {object[]} */
  const eligible = [];

  const ids = Array.from(staged_map.keys()).sort();
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const row = staged_map.get(id);
    const inf = row.inference || {};
    const tier = inf.confidence_tier || 'low';
    const primary = inf.genre_profile && inf.genre_profile.primary_genre;

    if (tier === 'low') {
      exclusion_counts.low_tier_blocklist += 1;
    }
    if (exclude_ost.has(id)) {
      exclusion_counts.ost_draft_blocklist += 1;
    }
    if (exclude_low_draft.has(id)) {
      exclusion_counts.low_correction_draft_blocklist += 1;
    }
    if (tier !== 'high') {
      exclusion_counts.not_high_tier += 1;
      continue;
    }
    if (!primary || primary === GENRE_PRIMARY_UNKNOWN) {
      exclusion_counts.primary_unknown += 1;
      continue;
    }
    if (inf.human_locked === true) {
      exclusion_counts.human_locked += 1;
      continue;
    }
    const override_row = overrides_doc.overrides_by_track_id[id] || null;
    if (manual_override_blocks_g3_f_genre_adopt(override_row)) {
      exclusion_counts.manual_override_blocks_genre += 1;
      continue;
    }
    if (ai_review[id] && AI_REVIEW_EXCLUDE_STATUSES.has(ai_review[id])) {
      exclusion_counts.ai_review_any += 1;
      continue;
    }
    if (exclude_ost.has(id)) {
      continue;
    }
    if (exclude_low_draft.has(id)) {
      continue;
    }
    if (tier === 'low') {
      continue;
    }

    const patch = inference_to_adopt_patch(inf, adopt_source);
    const validation = validate_adopt_patch(patch);
    if (!validation.ok) {
      exclusion_counts.schema_invalid += 1;
      continue;
    }

    exclusion_counts.eligible += 1;
    eligible.push({
      track_id: id,
      title: inf.title || null,
      wave_id: row.wave_id,
      wave_number: row.wave_number,
      batch_id: row.batch_id,
      staged_path: row.staged_path,
      confidence_tier: tier,
      inference_source: inf.source || null,
      adopt_patch: patch,
      schema_validation: validation,
    });
  }

  eligible.sort(function (a, b) {
    return a.track_id.localeCompare(b.track_id);
  });

  const batch_start = batch_index * batch_size;
  const batch = eligible.slice(batch_start, batch_start + batch_size);

  const tracks_by_id = (index_doc && index_doc.tracks_by_id) || {};
  /** @type {object[]} */
  const batch_preview = [];

  for (let b = 0; b < batch.length; b += 1) {
    const item = batch[b];
    const id = item.track_id;
    const index_row = tracks_by_id[id] || null;
    const before = classification_snapshot_from_index_row(index_row);
    const after = classification_snapshot_after_override(
      index_row,
      item.adopt_patch
    );
    const diff = diff_snapshots(before, after);

    const human = resolve_human_confirmation(id, {
      index_row: index_row,
      overrides_doc: overrides_doc,
      v2_review: null,
      phase_review: null,
    });

    const formal_if_override_merge = resolve_formal_classification_state({
      override_row: item.adopt_patch,
      v2_review: null,
      v2_candidate: null,
      in_ai_sample: false,
      index_genre_profile: after,
      index_tags: index_row ? index_row.tags : [],
    });

    batch_preview.push({
      ...item,
      index_metadata_status: index_row ? index_row.metadata_status : null,
      classification_diff: diff,
      human_confirmation_before: {
        locked: human.locked,
        sources: human.sources,
      },
      formal_state_warning: {
        if_merged_via_manual_overrides_json:
          formal_if_override_merge,
        note_zh:
          '現行 build_index 會將 manual-overrides 的 genre_profile 標為 confidence: confirmed，且 formal_state 常判為 confirmed；此為 AI inferred 採用時之已知風險，正式落地需另訂 g3_f_adopt_inferred 登錄或調整 build（本次未改）。',
        provenance_unverified: inf_provenance_unverified(
          staged_map.get(id).inference
        ),
      },
    });
  }

  const report = {
    schema_version: 1,
    mode: 'dry_run_only',
    write_to_production: false,
    adopt_source: adopt_source,
    generated_at: new Date().toISOString(),
    library_track_count: index_doc ? index_doc.track_count : null,
    batch_index: batch_index,
    batch_size: batch_size,
    eligible_total: eligible.length,
    batch_track_count: batch_preview.length,
    exclusion_counts: exclusion_counts,
    batch_track_ids: batch_preview.map(function (t) {
      return t.track_id;
    }),
    idempotency: {
      sort_key: 'track_id_asc',
      dedupe_rule: 'max_wave_number_wins',
      note_zh: '相同參數下 eligible 與 batch 選取應完全一致',
    },
    future_apply_hooks: {
      backup_paths_recommended: [
        'backup/classification/manual-overrides.json',
        'backup/classification/classification-index.json',
        'backup/classification/formal-classification-state.json',
      ],
      idempotent_merge_key: 'track_id',
      apply_not_implemented: true,
    },
    tracks: batch_preview,
  };

  if (write_reports) {
    fs.mkdirSync(output_dir, { recursive: true });
    const json_path = path.join(output_dir, 'preview.json');
    fs.writeFileSync(json_path, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(
      path.join(output_dir, 'preview.md'),
      render_preview_markdown(report),
      'utf8'
    );
    fs.writeFileSync(
      path.join(output_dir, 'exclusion-summary.json'),
      JSON.stringify(
        {
          schema_version: 1,
          exclusion_counts: exclusion_counts,
          eligible_total: eligible.length,
        },
        null,
        2
      ),
      'utf8'
    );
  }

  return report;
}

function inf_provenance_unverified(inference) {
  return !!(
    inference &&
    inference.provenance &&
    inference.provenance.provenance_unverified === true
  );
}

function render_preview_markdown(report) {
  const lines = [];
  lines.push('# G3-F 採用預覽（Dry-run）');
  lines.push('');
  lines.push('| 項目 | 值 |');
  lines.push('|------|-----|');
  lines.push('| 模式 | **dry_run_only**（無正式寫入） |');
  lines.push('| adopt_source | `' + report.adopt_source + '` |');
  lines.push('| 全庫 track_count | ' + report.library_track_count + ' |');
  lines.push('| staged 去重後 | ' + report.exclusion_counts.total_staged_deduped + ' |');
  lines.push('| 符合條件 eligible | **' + report.eligible_total + '** |');
  lines.push(
    '| 本批 batch | index=' +
      report.batch_index +
      ' size=' +
      report.batch_size +
      ' → **' +
      report.batch_track_count +
      '** 首 |'
  );
  lines.push('');
  lines.push('## 排除統計');
  lines.push('');
  lines.push('| 原因 | 數量 |');
  lines.push('|------|------|');
  const ec = report.exclusion_counts;
  lines.push('| 非 high tier | ' + ec.not_high_tier + ' |');
  lines.push('| 主曲風 unknown | ' + ec.primary_unknown + ' |');
  lines.push('| human_locked | ' + ec.human_locked + ' |');
  lines.push('| manual override 阻擋曲風 adopt | ' + ec.manual_override_blocks_genre + ' |');
  lines.push('| ai-review（pending/accept/modify/reject） | ' + ec.ai_review_any + ' |');
  lines.push('| low tier（32 池） | ' + ec.low_tier_blocklist + ' |');
  lines.push('| OST 草稿 3 首 | ' + ec.ost_draft_blocklist + ' |');
  lines.push('| Low 修正草稿 3 首 | ' + ec.low_correction_draft_blocklist + ' |');
  lines.push('| schema 不合格 | ' + ec.schema_invalid + ' |');
  lines.push('');
  lines.push('## formal / confirmed 警告');
  lines.push('');
  lines.push(
    '若未來直接 merge 進 `manual-overrides.json` 並 `classify:build`，現行程式會將 `genre_profile` 視為 **confirmed** 來源。正式採用前應改用 **g3_f_adopt 推論登錄** 或調整 build（本次未改 build）。'
  );
  lines.push('');
  lines.push('## 本批曲目');
  lines.push('');
  for (let i = 0; i < report.tracks.length; i += 1) {
    const t = report.tracks[i];
    lines.push('### ' + (i + 1) + '. ' + t.title + ' (`' + t.track_id + '`)');
    lines.push('');
    lines.push('- 波次：**' + t.wave_id + '**（F.' + t.wave_number + '）');
    lines.push('- 信心：**' + t.confidence_tier + '**');
    lines.push('- 變更欄位：' + (t.classification_diff.changed_fields.join('、') || '（無）'));
    lines.push(
      '- 主曲風：' +
        t.classification_diff.before.primary_genre +
        ' → **' +
        t.classification_diff.after.primary_genre +
        '**'
    );
    lines.push(
      '- 語言：' +
        t.classification_diff.before.language +
        ' → ' +
        t.classification_diff.after.language
    );
    lines.push(
      '- 若走 override merge → formal_state：**' +
        t.formal_state_warning.if_merged_via_manual_overrides_json +
        '**'
    );
    lines.push('');
  }
  return lines.join('\n');
}

export function parse_g3_f_adopt_preview_args(argv) {
  const args = argv || process.argv.slice(2);
  /** @type {Record<string, string|boolean|number>} */
  const out = {
    batch_size: 10,
    batch_index: 0,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--apply' || a === '--write' || a === '--enable-adopt') {
      out.forbidden = a;
    } else if (a.startsWith('--batch-size=')) {
      out.batch_size = parseInt(a.split('=')[1], 10);
    } else if (a.startsWith('--batch-index=')) {
      out.batch_index = parseInt(a.split('=')[1], 10);
    } else if (a.startsWith('--output-dir=')) {
      out.output_dir = a.slice('--output-dir='.length);
    }
  }
  return out;
}
