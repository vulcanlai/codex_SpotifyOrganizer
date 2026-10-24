/**
 * G3-D.4 主流程（可續跑）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { reconcile_d1_d3_d4 } from './g3_d4_reconcile.js';
import { export_g3_d4_batch_inputs } from './g3_d4_export_batch_inputs.js';
import { load_g3_d4_agent_batches } from './g3_d4_load_agent_drafts.js';
import { run_g3_d4_quality_checkpoint } from './g3_d4_quality_check.js';
import {
  compare_d1_d2_d34_200,
  load_d3_agent_tracks,
  merge_d3_d4_candidates,
} from './g3_d4_compare_200.js';
import { build_adopt_overlay_scheme } from './g3_d4_adopt_scheme.js';
import { build_d4_inference_source_overlay_v2 } from './g3_d4_inference_display.js';
import { G3_D1_BATCH_DRAFTS_DIR } from './paths_d1.js';
import path from 'node:path';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import {
  G3_D4_WAVE_DIR,
  FILE_G3_D4_RECONCILE,
  FILE_G3_D4_PENDING_170,
  FILE_G3_D4_BATCH_PLAN,
  FILE_G3_D4_PROGRESS,
  FILE_G3_D4_MERGED_AGENT_170,
  FILE_G3_D4_MERGED_CANDIDATE_200,
  FILE_G3_D4_COMPARISON_200,
  FILE_G3_D4_QUALITY_REPORT,
  FILE_G3_D4_OFFLINE_SUMMARY,
  G3_D4_BATCH_COUNT,
} from './paths_d4.js';

function load_d1_by_id() {
  /** @type {Record<string, object>} */
  const by_id = {};
  const files = fs.readdirSync(G3_D1_BATCH_DRAFTS_DIR).filter(function (f) {
    return f.endsWith('-imported.json');
  });
  for (let i = 0; i < files.length; i += 1) {
    const doc = JSON.parse(fs.readFileSync(path.join(G3_D1_BATCH_DRAFTS_DIR, files[i]), 'utf8'));
    for (let t = 0; t < doc.tracks.length; t += 1) {
      by_id[doc.tracks[t].track_id] = doc.tracks[t];
    }
  }
  return by_id;
}

/**
 * @param {{ write?: boolean, max_batch?: number, stop_on_qc_fail?: boolean }} [opts]
 */
export function run_g3_d4(opts) {
  const options = opts || {};
  const write = options.write !== false;
  const max_batch = options.max_batch || G3_D4_BATCH_COUNT;
  const stop_on_qc_fail = options.stop_on_qc_fail !== false;

  const reconcile = reconcile_d1_d3_d4();
  if (!reconcile.ok) {
    throw new Error('對帳失敗：' + JSON.stringify(reconcile.errors));
  }

  export_g3_d4_batch_inputs(reconcile, { write: write });

  const load_result = load_g3_d4_agent_batches(reconcile, { validate: true });
  const ev = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};

  /** @type {object[]} */
  const qc_checkpoints = [];
  const qc_batches = [3, 8, 13, 17];
  let halted = false;
  let halt_reason_zh = null;

  for (let q = 0; q < qc_batches.length; q += 1) {
    const through = qc_batches[q];
    if (through > max_batch) {
      break;
    }
    const rows = load_result.tracks.filter(function (row) {
      const batch_index = reconcile.batches.findIndex(function (b) {
        return b.track_ids.indexOf(row.track_id) >= 0;
      });
      return batch_index >= 0 && batch_index + 1 <= through;
    });
    if (!rows.length) {
      continue;
    }
    const cp = run_g3_d4_quality_checkpoint(rows, ev, {
      checkpoint_label: 'through-batch-' + String(through).padStart(2, '0'),
      through_batch: through,
    });
    qc_checkpoints.push(cp);
    if (!cp.pass && through <= 3 && stop_on_qc_fail) {
      halted = true;
      halt_reason_zh = '前 3 批品質檢查未通過：' + cp.systemic_flags_zh.join('；');
      break;
    }
    if (!cp.pass && stop_on_qc_fail) {
      halted = true;
      halt_reason_zh =
        '第 ' + through + ' 批 checkpoint 未通過：' + cp.systemic_flags_zh.join('；');
      break;
    }
  }

  const d3_tracks = load_d3_agent_tracks();
  const d4_tracks = load_result.tracks;
  const merged_by = merge_d3_d4_candidates(d3_tracks, d4_tracks);
  const merged_list = Object.keys(merged_by).map(function (k) {
    return merged_by[k];
  });

  const d1_by = load_d1_by_id();
  const comparison =
    merged_list.length === 200
      ? compare_d1_d2_d34_200(reconcile.d1_track_ids, d1_by, merged_list)
      : {
          schema_version: 1,
          incomplete: true,
          stats: { agent_candidate_count: merged_list.length, sample_size: 200 },
          per_track: [],
          note_zh: '候選未滿 200，略過完整比較',
        };

  const adopt_ids = reconcile.d1_track_ids.slice();
  const adopt = build_adopt_overlay_scheme(adopt_ids, merged_by, { write: write });
  const inference_overlay = build_d4_inference_source_overlay_v2({ write: write });

  const progress = {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    total_batches: G3_D4_BATCH_COUNT,
    completed_batches: load_result.completed_batches,
    agent_tracks_completed: load_result.success_count,
    agent_tracks_pending: 170 - load_result.success_count,
    batch_status: load_result.batch_status,
    halted: halted,
    halt_reason_zh: halt_reason_zh,
    max_batch_evaluated: max_batch,
  };

  const summary = {
    schema_version: 1,
    generated_at: progress.updated_at,
    reconcile_ok: reconcile.ok,
    d3_preserved: 30,
    d4_agent_completed: load_result.success_count,
    d4_agent_pending: 170 - load_result.success_count,
    merged_candidate_count: merged_list.length,
    quality_checkpoints: qc_checkpoints,
    halted: halted,
    halt_reason_zh: halt_reason_zh,
    comparison_stats: comparison.stats || null,
    adopt_enabled: false,
    inference_overlay_schema: inference_overlay.schema_version,
  };

  if (write) {
    fs.mkdirSync(G3_D4_WAVE_DIR, { recursive: true });
    write_json_atomic(FILE_G3_D4_RECONCILE, reconcile);
    write_json_atomic(FILE_G3_D4_PENDING_170, {
      seed: reconcile.pending_seed,
      track_ids: reconcile.pending_track_ids,
    });
    write_json_atomic(FILE_G3_D4_BATCH_PLAN, {
      batches: reconcile.batches,
      batch_size: 10,
      batch_count: 17,
    });
    write_json_atomic(FILE_G3_D4_PROGRESS, progress);
    write_json_atomic(FILE_G3_D4_MERGED_AGENT_170, {
      schema_version: 1,
      tracks: d4_tracks,
      count: d4_tracks.length,
    });
    write_json_atomic(FILE_G3_D4_MERGED_CANDIDATE_200, {
      schema_version: 1,
      d3_count: d3_tracks.length,
      d4_count: d4_tracks.length,
      tracks: merged_list,
    });
    write_json_atomic(FILE_G3_D4_COMPARISON_200, comparison);
    write_json_atomic(FILE_G3_D4_QUALITY_REPORT, { checkpoints: qc_checkpoints });
    write_json_atomic(FILE_G3_D4_OFFLINE_SUMMARY, summary);
  }

  return {
    summary: summary,
    reconcile: reconcile,
    progress: progress,
    load_result: load_result,
    comparison: comparison,
    adopt: adopt,
  };
}
