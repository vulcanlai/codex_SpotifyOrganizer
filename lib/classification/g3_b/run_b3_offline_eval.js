/**
 * G3-B.3 離線試驗（重用、欄位任務、批次計畫）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { build_g3_evidence_index } from '../g3_evidence/build_evidence_index.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { load_g3_source_bundle } from '../g3_evidence/source_loaders.js';
import { ensure_g3_b_sample } from './sample.js';
import { rule_classify_track } from './rule_classify.js';
import {
  build_ai_result_inventory,
  build_evidence_fingerprint,
} from './ai_result_catalog.js';
import { resolve_reuse_for_track } from './ai_result_reuse.js';
import { build_all_field_evidence_tasks } from './field_evidence_tasks.js';
import { build_batch_plan, init_batch_progress } from './batch_plan.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../../enrichment/external/g1_sample.js';
import {
  FILE_G3_B2_AI_PENDING,
  FILE_G3_B2_AUTO_REVIEW,
  FILE_G3_B2_QUEUE_STATES,
} from './paths_b2.js';
import {
  G3_B3_TRIAL_DIR,
  FILE_G3_B3_REUSE_REGISTRY,
  FILE_G3_B3_STILL_NEEDS_GEN,
  FILE_G3_B3_FIELD_TASKS,
  FILE_G3_B3_BATCH_PLAN,
  FILE_G3_B3_BATCH_PROGRESS,
  FILE_G3_B3_DEDUP_STATS,
  FILE_G3_B3_OFFLINE_SUMMARY,
  FILE_G3_B3_LEMON_TREE,
} from './paths_b3.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function load_evidence_index() {
  const path = file_g3_evidence_index();
  if (!fs.existsSync(path)) {
    build_g3_evidence_index({ write: true });
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function run_g3_b3_offline_eval(opts) {
  const options = opts || {};
  const write = options.write !== false;

  if (write && !fs.existsSync(G3_B3_TRIAL_DIR)) {
    fs.mkdirSync(G3_B3_TRIAL_DIR, { recursive: true });
  }

  const sample = ensure_g3_b_sample({ write: false });
  const evidence_index = load_evidence_index();
  const bundle = load_g3_source_bundle();
  const evidence_fp = build_evidence_fingerprint(evidence_index.source_fingerprints);

  const auto_review_doc = read_json(FILE_G3_B2_AUTO_REVIEW);
  const auto_results = auto_review_doc ? auto_review_doc.results : [];

  const inventory = build_ai_result_inventory(sample.track_ids, {
    bundle: bundle,
    evidence_fingerprint: evidence_fp,
    auto_review_results: auto_results,
  });

  const b2_pending = read_json(FILE_G3_B2_AI_PENDING);
  const pending_ids = (b2_pending && b2_pending.pending ? b2_pending.pending : []).map(
    function (p) {
      return p.track_id;
    }
  );

  const reuse_rows = [];
  let reusable_track_count = 0;
  let duplicate_sources_total = 0;
  const g3b1_ids = Object.keys(inventory.g3b1_by_id || {});

  for (let i = 0; i < inventory.per_track.length; i += 1) {
    const entry = inventory.per_track[i];
    const id = entry.track_id;
    const ev = evidence_index.tracks[id];
    const rule = rule_classify_track(ev);
    const reuse = resolve_reuse_for_track(id, entry, rule, {
      evidence_fingerprint: evidence_fp,
      treat_conflict_as_regen: false,
    });
    duplicate_sources_total += Math.max(0, reuse.duplicate_sources_count - 1);
    if (reuse.reusable) {
      reusable_track_count += 1;
    }
    reuse_rows.push(Object.assign({ title: ev.identity.title }, reuse));
  }

  const still_needs = [];
  for (let p = 0; p < pending_ids.length; p += 1) {
    const pid = pending_ids[p];
    const row = reuse_rows.find(function (r) {
      return r.track_id === pid;
    });
    if (row && row.reusable) {
      continue;
    }
    still_needs.push({
      track_id: pid,
      reason: row ? row.regen_reason || 'no_reusable_record' : 'not_in_reuse_index',
    });
  }

  const g3b1_in_still = g3b1_ids.filter(function (id) {
    return still_needs.some(function (s) {
      return s.track_id === id;
    });
  });

  const field_tasks = build_all_field_evidence_tasks(
    auto_results,
    inventory.g3b1_by_id,
    evidence_index.tracks
  );

  const batch_plan = build_batch_plan(
    still_needs.map(function (s) {
      return s.track_id;
    })
  );
  const batch_progress = init_batch_progress(
    batch_plan,
    read_json(FILE_G3_B3_BATCH_PROGRESS)
  );

  const lemon_tasks = field_tasks.filter(function (t) {
    return t.track_id === G1_MUST_INCLUDE_LEMON_TREE;
  });

  const needs_evidence_tracks = auto_results.filter(function (r) {
    return r.review.status === 'needs_evidence';
  }).length;

  const summary = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    sample_track_count: 30,
    reusable_ai_track_count: reusable_track_count,
    still_needs_ai_generation_count: still_needs.length,
    g3_b1_draft_count: g3b1_ids.length,
    g3_b1_erroneously_in_generation_queue: g3b1_in_still.length,
    field_evidence_task_count: field_tasks.length,
    needs_evidence_review_tracks: needs_evidence_tracks,
    batch_plan_batch_count: batch_plan.batch_count,
    duplicate_source_records_avoided: duplicate_sources_total,
    summary_zh: [
      '可重用 AI 分類 ' + reusable_track_count + ' 首（30 首樣本內）',
      '仍須新 AI 生成 ' + still_needs.length + ' 首（來自 B.2 pending_ai 扣除重用）',
      '欄位級補證據任務 ' + field_tasks.length + ' 項',
      'G3-B.1 十首誤入生成佇列 ' + g3b1_in_still.length + ' 首',
    ],
  };

  if (write) {
    write_json_atomic(FILE_G3_B3_REUSE_REGISTRY, {
      schema_version: 1,
      generated_at: summary.generated_at,
      evidence_fingerprint: evidence_fp,
      taxonomy_version: 1,
      tracks: reuse_rows,
      inventory_raw: inventory.per_track,
    });
    write_json_atomic(FILE_G3_B3_STILL_NEEDS_GEN, {
      schema_version: 1,
      generated_at: summary.generated_at,
      pending: still_needs,
    });
    write_json_atomic(FILE_G3_B3_FIELD_TASKS, {
      schema_version: 1,
      generated_at: summary.generated_at,
      tasks: field_tasks,
    });
    write_json_atomic(FILE_G3_B3_BATCH_PLAN, batch_plan);
    write_json_atomic(FILE_G3_B3_BATCH_PROGRESS, batch_progress);
    write_json_atomic(FILE_G3_B3_DEDUP_STATS, {
      schema_version: 1,
      generated_at: summary.generated_at,
      duplicate_source_records_avoided: duplicate_sources_total,
      per_track_sources: inventory.per_track.map(function (p) {
        return {
          track_id: p.track_id,
          source_count: p.records.length,
          sources: p.records.map(function (r) {
            return r.source;
          }),
        };
      }),
    });
    write_json_atomic(FILE_G3_B3_OFFLINE_SUMMARY, summary);
    if (lemon_tasks.length) {
      write_json_atomic(FILE_G3_B3_LEMON_TREE, {
        schema_version: 1,
        track_id: G1_MUST_INCLUDE_LEMON_TREE,
        tasks: lemon_tasks,
      });
    }
  }

  return {
    summary: summary,
    reuse_rows: reuse_rows,
    still_needs: still_needs,
    field_tasks: field_tasks,
    batch_plan: batch_plan,
    g3b1_in_still: g3b1_in_still,
  };
}
