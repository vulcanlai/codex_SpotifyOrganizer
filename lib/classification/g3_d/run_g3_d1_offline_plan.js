/**
 * G3-D.1 離線：200 首樣本、批次計畫、批次輸入匯出
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { build_batch_plan, init_batch_progress } from '../g3_b/batch_plan.js';
import {
  build_g3b6_draft_template,
  build_track_payloads_for_ids,
} from '../g3_b/export_ai_input_b6.js';
import { build_g3_d1_expansion_pool } from './g3_d1_pool.js';
import { select_g3_d1_wave_ids } from './g3_d1_stratify.js';
import { run_g3_d1_pre_execution_check } from './g3_d1_precheck.js';
import {
  G3_D1_WAVE_DIR,
  G3_D1_BATCH_INPUTS_DIR,
  FILE_G3_D1_SAMPLE_200,
  FILE_G3_D1_POOL_SUMMARY,
  FILE_G3_D1_STRATIFICATION,
  FILE_G3_D1_BATCH_PLAN,
  FILE_G3_D1_BATCH_PROGRESS,
  FILE_G3_D1_PRECHECK,
  FILE_G3_D1_OFFLINE_SUMMARY,
  G3_D1_BATCH_SIZE,
  G3_D1_SCHEMA_VERSION,
} from './paths_d1.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function run_g3_d1_offline_plan(opts) {
  const options = opts || {};
  const write = options.write !== false;

  const pre = run_g3_d1_pre_execution_check();
  if (!pre.safe_to_proceed) {
    throw new Error('G3-D.1 執行前檢查未通過：' + (pre.blockers || []).join('; '));
  }

  const selection = select_g3_d1_wave_ids(200);
  const ids = selection.selected_ids.slice().sort();
  if (ids.length !== 200) {
    throw new Error('200 首樣本數量錯誤：' + ids.length);
  }
  const uniq = {};
  for (let u = 0; u < ids.length; u += 1) {
    if (uniq[ids[u]]) {
      throw new Error('200 首重複：' + ids[u]);
    }
    uniq[ids[u]] = true;
  }

  const pool = build_g3_d1_expansion_pool();
  const batch_plan = build_batch_plan(ids, G3_D1_BATCH_SIZE, {
    batch_id_prefix: 'g3d1-batch-',
  });
  const batch_progress = init_batch_progress(
    batch_plan,
    read_json(FILE_G3_D1_BATCH_PROGRESS)
  );

  const summary = {
    schema_version: G3_D1_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    wave_size: 200,
    pool_needs_new_ai: pool.needs_new_cursor_ai,
    batch_count: batch_plan.batch_count,
    batch_size: G3_D1_BATCH_SIZE,
    seed: selection.seed,
    precheck_passed: true,
    summary_zh: [
      '第一波 200 首自需新 AI 母體 ' + pool.needs_new_cursor_ai + ' 中分層抽取',
      '批次 ' + batch_plan.batch_count + ' 批（每批最多 ' + G3_D1_BATCH_SIZE + ' 首）',
      '不得重跑 G3-B 100 首或可重用 ' + pool.reusable_ai_outside_g3_b + ' 首',
    ],
  };

  if (write) {
    fs.mkdirSync(G3_D1_WAVE_DIR, { recursive: true });
    fs.mkdirSync(G3_D1_BATCH_INPUTS_DIR, { recursive: true });
    write_json_atomic(FILE_G3_D1_SAMPLE_200, {
      schema_version: G3_D1_SCHEMA_VERSION,
      generated_at: summary.generated_at,
      seed: selection.seed,
      track_ids: ids,
    });
    write_json_atomic(FILE_G3_D1_POOL_SUMMARY, {
      schema_version: G3_D1_SCHEMA_VERSION,
      ...pool,
      pool_rows: undefined,
      reusable_audit: pool.reusable_audit.slice(0, 50),
      reusable_audit_truncated: pool.reusable_audit.length > 50,
    });
    write_json_atomic(FILE_G3_D1_STRATIFICATION, {
      schema_version: G3_D1_SCHEMA_VERSION,
      generated_at: summary.generated_at,
      seed: selection.seed,
      distribution: selection.distribution,
      shortfalls_zh: selection.shortfalls_zh,
      rules_zh: [
        '母體：需新 Cursor AI（排除 G3-B catalog 與可重用 v2/phase-e）',
        '固定 seed 貪婪多樣性',
        '歌名腳本／索引語言非演唱語言定案',
      ],
    });
    write_json_atomic(FILE_G3_D1_BATCH_PLAN, batch_plan);
    write_json_atomic(FILE_G3_D1_BATCH_PROGRESS, batch_progress);
    write_json_atomic(FILE_G3_D1_PRECHECK, pre);
    write_json_atomic(FILE_G3_D1_OFFLINE_SUMMARY, summary);

    for (let b = 0; b < batch_plan.batches.length; b += 1) {
      const batch = batch_plan.batches[b];
      const input_doc = build_g3b6_draft_template(batch.batch_id, batch.track_ids);
      const payloads = build_track_payloads_for_ids(batch.track_ids);
      input_doc.source = 'g3_d1_batch_input';
      input_doc.model_note =
        'G3-D.1 批次輸入；由 Cursor Agent 填寫 tracks 後存至 cursor-drafts/' +
        batch.batch_id +
        '.json';
      input_doc.evidence_payloads = payloads;
      input_doc.tracks = input_doc.tracks.map(function (t) {
        return Object.assign({}, t, {
          method: 'g3_d1_cursor_ai',
          _agent_fill_required: true,
        });
      });
      write_json_atomic(
        G3_D1_BATCH_INPUTS_DIR + '/' + batch.batch_id + '-input.json',
        input_doc
      );
    }
  }

  return {
    summary: summary,
    selection: selection,
    batch_plan: batch_plan,
    precheck: pre,
  };
}
