/**
 * G3-F 採用 dry-run／授權 apply（apply 需明確授權旗標）
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FILE_CLASSIFICATION_INDEX,
  FILE_G3_F_ADOPT_REGISTRY,
} from '../paths.js';
import { build_classification_index } from '../build_index.js';
import { build_formal_classification_state } from '../formal_state_build.js';
import { empty_overrides_doc } from '../overrides_store.js';
import { load_g3_f_adopt_registry, merge_g3_f_adopt_batch_idempotent, save_g3_f_adopt_registry } from './g3_f_adopt_registry_store.js';
import { select_g3_f_adopt_batch } from './g3_f_eligible.js';
import { create_g3_f_adopt_backup, restore_g3_f_adopt_backup } from './g3_f_adopt_backup.js';
import {
  build_g3_f_adopt_plan,
  load_g3_f_adopt_plan_file,
  validate_plan_for_apply,
  write_g3_f_adopt_plan_files,
  candidate_from_plan_track,
} from './g3_f_adopt_plan.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import {
  DIMENSION_LANGUAGE,
  DIMENSION_CONTEXT,
  DIMENSION_SPECIAL,
} from '../dimensions.js';

export const G3_F_ADOPT_AUTHORIZE_TOKEN = 'I_UNDERSTAND_G3_F_ADOPT';

function read_json_safe(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
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

function track_classification_view(row) {
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
    genre_profile_confidence: gp.confidence || null,
  };
}

function diff_view(before, after) {
  const changed_fields = [];
  if (!before || !after) {
    return { changed_fields: ['missing_row'], before, after };
  }
  const keys = [
    'primary_genre',
    'subgenres',
    'secondary_genres',
    'language',
    'contexts',
    'special_types',
    'genre_profile_confidence',
    'genre_profile_source',
  ];
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      changed_fields.push(k);
    }
  }
  return { changed_fields, before, after };
}

function summary_primary_delta(before_summary, after_summary, track_ids) {
  const delta = {};
  for (let i = 0; i < track_ids.length; i += 1) {
    const id = track_ids[i];
    delta[id] = { note: 'see per_track classification_diff' };
  }
  return {
    track_count_before: before_summary.track_count,
    track_count_after: after_summary.track_count,
    language_unconfirmed_before: before_summary.language_unconfirmed,
    language_unconfirmed_after: after_summary.language_unconfirmed,
    genre_unconfirmed_before: before_summary.genre_unconfirmed,
    genre_unconfirmed_after: after_summary.genre_unconfirmed,
    per_track_keys: track_ids,
  };
}

/**
 * @param {object} [opts]
 */
export function run_g3_f_adopt_dry_run(opts) {
  const options = opts || {};
  const batch_size = options.batch_size != null ? options.batch_size : 10;
  const batch_index = options.batch_index != null ? options.batch_index : 0;
  const write_reports = options.write_reports !== false;
  const output_dir =
    options.output_dir ||
    path.join(
      options.project_root || process.cwd(),
      'reports',
      'g3-f-adopt',
      'dry-run-v2'
    );

  const selection = select_g3_f_adopt_batch({
    batch_size,
    batch_index,
    skip_registry_adopted: options.skip_registry_adopted,
    registry_file_path: options.registry_file_path,
  });
  const batch = selection.batch;
  const existing_registry = load_g3_f_adopt_registry({
    file_path: options.registry_file_path,
  });
  const merge = merge_g3_f_adopt_batch_idempotent(existing_registry, batch);
  const simulated_registry = merge.registry_doc;

  const built_before = build_classification_index({
    write: false,
    g3_f_registry_doc: existing_registry,
  });
  const built_after = build_classification_index({
    write: false,
    g3_f_registry_doc: simulated_registry,
  });

  const formal_before = build_formal_classification_state(built_before.index_doc, {
    write: false,
    g3_f_registry_doc: existing_registry,
  });
  const formal_after = build_formal_classification_state(built_after.index_doc, {
    write: false,
    g3_f_registry_doc: simulated_registry,
  });

  const batch_ids = batch.map(function (t) {
    return t.track_id;
  });
  /** @type {object[]} */
  const per_track = [];
  for (let i = 0; i < batch_ids.length; i += 1) {
    const id = batch_ids[i];
    const before_row = built_before.index_doc.tracks_by_id[id];
    const after_row = built_after.index_doc.tracks_by_id[id];
    const before_view = track_classification_view(before_row);
    const after_view = track_classification_view(after_row);
    per_track.push({
      track_id: id,
      title: batch[i].title,
      wave_id: batch[i].wave_id,
      wave_number: batch[i].wave_number,
      confidence_tier: batch[i].confidence_tier,
      classification_diff: diff_view(before_view, after_view),
      formal_state: {
        before: formal_before.states_by_track_id[id]?.formal_state || null,
        after: formal_after.states_by_track_id[id]?.formal_state || null,
      },
      registry_merge: {
        would_apply: merge.applied.some(function (a) {
          return a.track_id === id;
        }),
        would_skip: merge.skipped.some(function (s) {
          return s.track_id === id;
        }),
      },
    });
  }

  const index_doc_on_disk = read_json_safe(FILE_CLASSIFICATION_INDEX);
  const report = {
    schema_version: 1,
    mode: 'dry_run',
    write_to_production: false,
    eligible_total: selection.eligible.length,
    eligible_pending_adoption: selection.eligible_pending_adoption,
    skip_registry_adopted: selection.skip_registry_adopted,
    batch_index,
    batch_size,
    batch_track_count: batch.length,
    batch_track_ids: batch_ids,
    exclusion_counts: selection.exclusion_counts,
    registry_simulation: {
      existing_adopted_count: Object.keys(existing_registry.adoptions_by_track_id || {}).length,
      after_simulated_count: Object.keys(simulated_registry.adoptions_by_track_id || {}).length,
      merge_applied: merge.applied,
      merge_skipped: merge.skipped,
      merge_conflicts: merge.conflicts,
    },
    library_track_count: index_doc_on_disk ? index_doc_on_disk.track_count : null,
    summary_delta: summary_primary_delta(
      built_before.summary_doc,
      built_after.summary_doc,
      batch_ids
    ),
    formal_state_batch_after: per_track.map(function (t) {
      return { track_id: t.track_id, formal_state: t.formal_state.after };
    }),
    tracks: per_track,
    idempotency: {
      sort_key: 'track_id_asc',
      registry_merge: 'idempotency_key',
    },
    apply_requirements: {
      authorize_flag: '--authorize-apply=' + G3_F_ADOPT_AUTHORIZE_TOKEN,
      apply_plan_flag: '--apply-plan=<path/to/apply-plan.json>',
      backup_first: true,
      then: ['validate plan', 'merge registry batch', 'npm run classify:build'],
    },
  };

  const adopt_plan = build_g3_f_adopt_plan({
    batch: batch,
    registry_doc: existing_registry,
    batch_size: batch_size,
    batch_index: batch_index,
    skip_registry_adopted: selection.skip_registry_adopted,
    batch_id: options.plan_batch_id,
  });
  report.adopt_plan = {
    batch_id: adopt_plan.batch_id,
    plan_hash: adopt_plan.plan_hash,
    registry_baseline: adopt_plan.registry_baseline,
  };

  if (write_reports) {
    fs.mkdirSync(output_dir, { recursive: true });
    fs.writeFileSync(path.join(output_dir, 'dry-run.json'), JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(
      path.join(output_dir, 'dry-run.md'),
      render_dry_run_md(report),
      'utf8'
    );
    write_g3_f_adopt_plan_files(adopt_plan, output_dir);
  }

  report.apply_plan_path = write_reports ? path.join(output_dir, 'apply-plan.json') : null;
  report.plan_hash = adopt_plan.plan_hash;
  report.batch_id = adopt_plan.batch_id;

  return report;
}

function render_dry_run_md(report) {
  const lines = [];
  lines.push('# G3-F 採用 Dry-run（registry v2）');
  lines.push('');
  lines.push('- eligible：**' + report.eligible_total + '**');
  lines.push('- 本批：**' + report.batch_track_count + '** 首');
  lines.push('- 全庫 track_count：' + report.library_track_count);
  lines.push('');
  lines.push('## 本批正式分類預期');
  lines.push('');
  for (let i = 0; i < report.tracks.length; i += 1) {
    const t = report.tracks[i];
    const d = t.classification_diff;
    lines.push('### ' + (i + 1) + '. ' + t.title + ' (`' + t.track_id + '`)');
    lines.push('- 波次：' + t.wave_id);
    lines.push('- formal：**' + t.formal_state.before + '** → **' + t.formal_state.after + '**');
    lines.push(
      '- 主曲風：' +
        d.before.primary_genre +
        ' → **' +
        d.after.primary_genre +
        '**（confidence ' +
        d.before.genre_profile_confidence +
        ' → **' +
        d.after.genre_profile_confidence +
        '**）'
    );
    lines.push('- 語言：' + d.before.language + ' → ' + d.after.language);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 模擬 apply（僅驗證，不寫入）
 * @param {object} opts
 */
export function simulate_g3_f_adopt_apply_from_plan(opts) {
  const options = opts || {};
  const plan =
    options.plan ||
    load_g3_f_adopt_plan_file(options.apply_plan_path || options.plan_path);
  const registry_doc = load_g3_f_adopt_registry({
    file_path: options.registry_file_path,
  });
  const validation = validate_plan_for_apply({
    plan: plan,
    registry_doc: registry_doc,
    staged_map: options.staged_map,
    overrides_doc: options.overrides_doc,
    ai_review: options.ai_review,
  });
  const adopted_before = Object.keys(registry_doc.adoptions_by_track_id || {}).filter(function (id) {
    return registry_doc.adoptions_by_track_id[id].status === 'adopted';
  }).length;
  return format_apply_result_summary({
    mode: 'apply_simulate',
    plan: plan,
    validation: validation,
    adopted_before: adopted_before,
    adopted_after:
      validation.result === 'ready'
        ? adopted_before + (validation.insert_count || 0)
        : adopted_before,
    backup_dir: null,
    reports_dir: options.reports_dir || null,
  });
}

/**
 * @param {object} opts
 */
export function run_g3_f_adopt_apply_from_plan(opts) {
  const options = opts || {};
  if (options.authorize_token !== G3_F_ADOPT_AUTHORIZE_TOKEN) {
    throw new Error('缺少或錯誤的授權 token；正式採用需 --authorize-apply=' + G3_F_ADOPT_AUTHORIZE_TOKEN);
  }
  if (!options.apply_plan_path && !options.plan) {
    throw new Error(
      '已停用舊式 apply：必須提供 --apply-plan=<apply-plan.json>，不可僅用 batch-size／batch-index 正式寫入'
    );
  }
  if (options.allow_production_write !== true) {
    throw new Error('allow_production_write 必須為 true 才寫入正式路徑');
  }

  const plan =
    options.plan || load_g3_f_adopt_plan_file(options.apply_plan_path);
  let registry_doc = load_g3_f_adopt_registry({ file_path: options.registry_file_path });
  const adopted_before = Object.keys(registry_doc.adoptions_by_track_id || {}).filter(function (id) {
    return registry_doc.adoptions_by_track_id[id].status === 'adopted';
  }).length;

  const validation = validate_plan_for_apply({
    plan: plan,
    registry_doc: registry_doc,
    staged_map: options.staged_map,
    overrides_doc: options.overrides_doc,
    ai_review: options.ai_review,
  });

  if (!validation.ok) {
    const err = new Error('[g3-f-adopt] apply 驗證失敗：' + JSON.stringify(validation));
    err.validation = validation;
    throw err;
  }

  if (validation.result === 'already_applied') {
    return format_apply_result_summary({
      mode: 'apply',
      result: 'already_applied',
      plan: plan,
      validation: validation,
      adopted_before: adopted_before,
      adopted_after: adopted_before,
      backup_dir: null,
      reports_dir: path.dirname(options.apply_plan_path || ''),
    });
  }

  if (validation.result !== 'ready') {
    throw new Error('[g3-f-adopt] 非 ready 狀態，已中止：' + JSON.stringify(validation));
  }

  /** @type {object|null} */
  let backup = null;
  if (options.skip_backup !== true) {
    backup = create_g3_f_adopt_backup(options);
  }

  /** @type {object[]} */
  const candidates = plan.tracks.map(function (t) {
    return candidate_from_plan_track(t);
  });
  const merge = merge_g3_f_adopt_batch_idempotent(registry_doc, candidates);
  if (merge.conflicts.length || merge.applied.length !== plan.tracks.length) {
    throw new Error(
      '[g3-f-adopt] merge 與 plan 不一致，已中止（未寫入 registry）：' +
        JSON.stringify({ applied: merge.applied.length, conflicts: merge.conflicts })
    );
  }

  registry_doc = save_g3_f_adopt_registry(merge.registry_doc, {
    file_path: options.registry_file_path || FILE_G3_F_ADOPT_REGISTRY,
  });

  if (options.skip_index_rebuild !== true) {
    build_classification_index({ write: true, g3_f_registry_doc: registry_doc });
  }

  const adopted_after = Object.keys(registry_doc.adoptions_by_track_id || {}).filter(function (id) {
    return registry_doc.adoptions_by_track_id[id].status === 'adopted';
  }).length;

  return format_apply_result_summary({
    mode: 'apply',
    result: 'applied',
    plan: plan,
    validation: validation,
    merge: merge,
    adopted_before: adopted_before,
    adopted_after: adopted_after,
    backup_dir: backup ? backup.backup_dir : null,
    reports_dir: path.dirname(options.apply_plan_path || ''),
  });
}

/** @deprecated 請使用 run_g3_f_adopt_apply_from_plan */
export function run_g3_f_adopt_apply_authorized(opts) {
  return run_g3_f_adopt_apply_from_plan(opts);
}

/**
 * @param {object} p
 */
export function format_apply_result_summary(p) {
  const validation = p.validation || {};
  const plan = p.plan || {};
  const merge = p.merge || {};
  const out = {
    mode: p.mode,
    result: p.result || validation.result || (validation.ok ? 'ok' : 'rejected'),
    batch_id: plan.batch_id || null,
    batch_track_count: plan.tracks ? plan.tracks.length : 0,
    insert_count: validation.insert_count != null ? validation.insert_count : merge.applied?.length || 0,
    skip_count: validation.skip_count != null ? validation.skip_count : merge.skipped?.length || 0,
    conflict_count: validation.conflict_count != null ? validation.conflict_count : merge.conflicts?.length || 0,
    adopted_before: p.adopted_before,
    adopted_after: p.adopted_after,
    plan_hash: plan.plan_hash || null,
    backup_dir: p.backup_dir,
    reports_dir: p.reports_dir,
  };
  if (p.verbose && merge.applied) {
    out.merge = merge;
    out.batch_track_ids = plan.tracks ? plan.tracks.map(function (t) {
      return t.track_id;
    }) : [];
  }
  return out;
}

/**
 * @param {object} report dry-run report
 * @param {boolean} [verbose]
 */
export function format_dry_run_cli_summary(report, verbose) {
  const out = {
    mode: report.mode,
    batch_id: report.batch_id,
    batch_track_count: report.batch_track_count,
    plan_hash: report.plan_hash,
    reports_dir: report.apply_plan_path ? path.dirname(report.apply_plan_path) : null,
    result: 'plan_ready',
  };
  if (verbose) {
    out.eligible_total = report.eligible_total;
    out.batch_track_ids = report.batch_track_ids;
    out.adopt_plan = report.adopt_plan;
  }
  return out;
}

export function parse_g3_f_adopt_cli_args(argv) {
  const args = argv || process.argv.slice(2);
  /** @type {Record<string, string|number|boolean>} */
  const out = {
    batch_size: 10,
    batch_index: 0,
    dry_run: true,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--apply') {
      out.dry_run = false;
    } else if (a === '--include-registry-adopted') {
      out.skip_registry_adopted = false;
    } else if (a.startsWith('--authorize-apply=')) {
      out.authorize_token = a.slice('--authorize-apply='.length);
      out.dry_run = false;
    } else if (a.startsWith('--batch-size=')) {
      out.batch_size = parseInt(a.split('=')[1], 10);
    } else if (a.startsWith('--batch-index=')) {
      out.batch_index = parseInt(a.split('=')[1], 10);
    } else if (a.startsWith('--output-dir=')) {
      out.output_dir = a.slice('--output-dir='.length);
    } else if (a.startsWith('--apply-plan=')) {
      out.apply_plan_path = a.slice('--apply-plan='.length);
      out.dry_run = false;
    } else if (a === '--verbose') {
      out.verbose = true;
    } else if (a === '--simulate-apply') {
      out.simulate_apply = true;
      out.dry_run = false;
    }
  }
  return out;
}

export { restore_g3_f_adopt_backup, create_g3_f_adopt_backup };
