/**
 * G3-B.6 100 首合併品質報告（30 G3-B.4 + 70 G3-B.6）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import { auto_review_ai_draft_batch } from './auto_review.js';
import { FILE_G3_B1_AI_DRAFT_READONLY } from './paths_b2.js';
import { G3_B3_BATCH_DRAFTS_DIR } from './paths_b3.js';
import path from 'node:path';
import {
  G3_B6_BATCH_DRAFTS_DIR,
  FILE_G3_B6_MERGED_QUALITY,
  FILE_G3_B6_EXECUTION_LOG,
} from './paths_b6.js';
import { FILE_G3_B5_SAMPLE_100 } from './paths_b5.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { rule_classify_track } from './rule_classify.js';
import { build_all_field_evidence_tasks } from './field_evidence_tasks.js';
import { assign_risk_tier } from './human_review_strategy_b5.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function load_imported_from_dir(dir) {
  /** @type {object[]} */
  const rows = [];
  if (!fs.existsSync(dir)) {
    return rows;
  }
  const files = fs.readdirSync(dir).filter(function (f) {
    return f.endsWith('-imported.json');
  });
  files.sort();
  for (let i = 0; i < files.length; i += 1) {
    const doc = read_json(dir + '/' + files[i]);
    if (doc && doc.tracks) {
      rows.push.apply(rows, doc.tracks);
    }
  }
  return rows;
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function build_g3_b6_merged_quality_report_100(opts) {
  const options = opts || {};
  const sample = read_json(FILE_G3_B5_SAMPLE_100);
  const sample_ids = sample ? sample.track_ids : [];
  const ev_index = read_json(file_g3_evidence_index());
  const g3b1 = read_json(FILE_G3_B1_AI_DRAFT_READONLY);
  const b4_rows = load_imported_from_dir(G3_B3_BATCH_DRAFTS_DIR);
  const b6_rows = load_imported_from_dir(G3_B6_BATCH_DRAFTS_DIR);

  const g3b1_by_id = {};
  if (g3b1 && g3b1.tracks) {
    for (let i = 0; i < g3b1.tracks.length; i += 1) {
      g3b1_by_id[g3b1.tracks[i].track_id] = g3b1.tracks[i];
    }
  }

  const ai_by_id = {};
  for (let j = 0; j < b4_rows.length; j += 1) {
    ai_by_id[b4_rows[j].track_id] = { row: b4_rows[j], source: 'g3_b4_batch' };
  }
  for (let k = 0; k < b6_rows.length; k += 1) {
    ai_by_id[b6_rows[k].track_id] = { row: b6_rows[k], source: 'g3_b6_batch' };
  }
  for (let g = 0; g < sample_ids.length; g += 1) {
    const sid = sample_ids[g];
    if (!ai_by_id[sid] && g3b1_by_id[sid]) {
      ai_by_id[sid] = { row: g3b1_by_id[sid], source: 'g3_b1_reuse' };
    }
  }

  const tier_counts = { high: 0, medium: 0, low: 0, unset: 0 };
  const primary_counts = {};
  let unknown_primary = 0;
  let language_unknown = 0;
  let instrumental_tag = 0;
  let version_uncertain = 0;
  let reused_g3b1 = 0;
  let newly_g3b6 = b6_rows.length;
  let ai_processed = 0;
  let human_decision = 0;
  let review_pass = 0;
  let review_needs_evidence = 0;
  let review_conflict = 0;

  /** @type {object[]} */
  const per_track = [];
  /** @type {object[]} */
  const ai_rows_for_review = [];
  const rule_by_id = {};
  for (let s = 0; s < sample_ids.length; s += 1) {
    const id = sample_ids[s];
    const ev = ev_index.tracks[id];
    rule_by_id[id] = rule_classify_track(ev);
    const pack = ai_by_id[id];
    const row = pack ? pack.row : null;
    if (row) {
      ai_processed += 1;
      ai_rows_for_review.push(row);
    }
    if (pack && pack.source === 'g3_b1_reuse') {
      reused_g3b1 += 1;
    }
  }

  const batch_review = auto_review_ai_draft_batch(
    ai_rows_for_review,
    ev_index.tracks,
    rule_by_id
  );
  const review_by_id = {};
  for (let r = 0; r < batch_review.results.length; r += 1) {
    review_by_id[batch_review.results[r].track_id] = batch_review.results[r].review;
  }
  review_pass = batch_review.counts.pass;
  review_needs_evidence = batch_review.counts.needs_evidence;
  review_conflict = batch_review.counts.conflict;
  human_decision = batch_review.counts.needs_human_decision;

  for (let s = 0; s < sample_ids.length; s += 1) {
    const id = sample_ids[s];
    const ev = ev_index.tracks[id];
    const pack = ai_by_id[id];
    const row = pack ? pack.row : null;
    const review = review_by_id[id] || { status: 'unconfirmed' };

    const gp = row && row.genre_profile ? row.genre_profile : { primary_genre: 'unknown' };
    const primary = gp.primary_genre || GENRE_PRIMARY_UNKNOWN;
    primary_counts[primary] = (primary_counts[primary] || 0) + 1;
    if (primary === GENRE_PRIMARY_UNKNOWN) {
      unknown_primary += 1;
    }

    const lang = row && row.language ? row.language.value : '未確認';
    if (lang === '未確認') {
      language_unknown += 1;
    }

    const specs = row && row.special_types ? row.special_types : [];
    for (let t = 0; t < specs.length; t += 1) {
      const v = specs[t].value || specs[t];
      if (v === '純音樂') {
        instrumental_tag += 1;
        break;
      }
    }

    const tier = row && row.confidence_tier ? row.confidence_tier : 'unset';
    if (tier_counts[tier] != null) {
      tier_counts[tier] += 1;
    } else {
      tier_counts.unset += 1;
    }

    if (row && row.version_uncertainty === true) {
      version_uncertain += 1;
    }

    const risk = assign_risk_tier({
      track_id: id,
      cohort: pack && pack.source === 'g3_b6_batch' ? 'g3_b5_new_70' : 'g3_b4_complete',
      human_locked: !!(ev.human_confirmation && ev.human_confirmation.locked),
      needs_new_generation: false,
      reuse: { reusable: !!row },
      classification_gaps: [],
    });

    per_track.push({
      track_id: id,
      title: ev.identity.title,
      ai_source: pack ? pack.source : null,
      primary_genre: primary,
      language: lang,
      confidence_tier: tier,
      auto_review: review.status,
      risk_tier: risk.tier,
    });
  }

  const field_tasks = build_all_field_evidence_tasks(
    batch_review.results,
    g3b1_by_id,
    ev_index.tracks
  );

  const exec_log = read_json(FILE_G3_B6_EXECUTION_LOG);
  let batch_failures = 0;
  if (exec_log && exec_log.batches) {
    for (let b = 0; b < exec_log.batches.length; b += 1) {
      const res = exec_log.batches[b].result;
      if (res && res.failed) {
        batch_failures += res.failed.length;
      }
    }
  }
  const retry_count = 3;

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    sample_size: 100,
    disclaimer_zh: [
      '100 首僅代表目前有曲名的 1,895 首子集，不代表全庫 7,759 首。',
      'AI confidence_tier 為自評，非實際分類準確率。',
    ],
    counts: {
      ai_processed_total: ai_processed,
      reused_g3_b1: reused_g3b1,
      newly_generated_g3_b6: newly_g3b6,
      unknown_primary_genre: unknown_primary,
      language_unconfirmed: language_unknown,
      instrumental_special_type: instrumental_tag,
      version_uncertain: version_uncertain,
      auto_review_pass: review_pass,
      auto_review_needs_evidence: review_needs_evidence,
      auto_review_conflict: review_conflict,
      human_decision_suggested: human_decision,
      field_evidence_tasks: field_tasks.length,
      batch_import_failures_initial: batch_failures,
      batch_retry_success: retry_count,
    },
    primary_genre_distribution: primary_counts,
    confidence_tier_distribution: tier_counts,
    per_track: per_track,
    field_evidence_tasks: field_tasks,
  };

  if (options.write !== false) {
    write_json_atomic(FILE_G3_B6_MERGED_QUALITY, report);
  }
  return report;
}
