/**
 * G3-D.1 執行前檢查
 */
import fs from 'node:fs';
import { build_g3_d1_expansion_pool, analyze_primary_display_gap } from './g3_d1_pool.js';
import { load_g3_b_ai_catalog } from '../g3_c/load_g3_b_ai_catalog.js';
import { build_expansion_plan_1895 } from '../g3_c/g3_c2_acceptance.js';
import { FILE_G3_B1_AI_DRAFT_READONLY } from '../g3_b/paths_b2.js';
import { FILE_G3_B5_SAMPLE_100 } from '../g3_b/paths_b5.js';
import path from 'node:path';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * @returns {object}
 */
export function run_g3_d1_pre_execution_check() {
  const pool = build_g3_d1_expansion_pool();
  const c2 = build_expansion_plan_1895();
  const primary_gap = analyze_primary_display_gap();
  const catalog = load_g3_b_ai_catalog();

  /** @type {string[]} */
  const blockers = [];
  /** @type {string[]} */
  const warnings = [];

  if (pool.titled_track_count !== c2.titled_track_count) {
    blockers.push(
      '擴大計畫與 D.1 pool 有曲名數不一致：pool=' +
        pool.titled_track_count +
        ' c2=' +
        c2.titled_track_count
    );
  }
  if (pool.g3_b_classified_count !== 100) {
    blockers.push('G3-B 已分類非 100：' + pool.g3_b_classified_count);
  }
  if (pool.needs_new_cursor_ai !== c2.needs_new_cursor_ai) {
    warnings.push(
      '需新 AI 與 G3-C.2 快照不一致：pool=' +
        pool.needs_new_cursor_ai +
        ' c2=' +
        c2.needs_new_cursor_ai
    );
  }

  const reusable_bad = pool.reusable_audit.filter(function (r) {
    return !r.schema_ok;
  });
  if (reusable_bad.length) {
    warnings.push(
      '可重用候選字典／曲風稽核異常 ' +
        reusable_bad.length +
        ' 首（多為歷史 phase-e 子曲風；不阻擋 D.1）'
    );
  }

  const sample100 = read_json(FILE_G3_B5_SAMPLE_100);
  if (sample100 && sample100.track_ids) {
    for (let i = 0; i < sample100.track_ids.length; i += 1) {
      if (!catalog.by_id[sample100.track_ids[i]]) {
        warnings.push('試驗 100 缺少 catalog：' + sample100.track_ids[i]);
      }
    }
  }

  const b1_before = fs.existsSync(FILE_G3_B1_AI_DRAFT_READONLY)
    ? fs.statSync(FILE_G3_B1_AI_DRAFT_READONLY).mtimeMs
    : 0;

  const phase_e_test = path.join(process.cwd(), 'test/classification_phase_e.test.js');
  const phase_e_exists = fs.existsSync(phase_e_test);

  return {
    schema_version: 1,
    checked_at: new Date().toISOString(),
    counts: {
      titled: pool.titled_track_count,
      g3_b_ai: pool.g3_b_classified_count,
      reusable_outside_g3_b: pool.reusable_ai_outside_g3_b,
      needs_new_ai: pool.needs_new_cursor_ai,
      c2_needs_new_ai: c2.needs_new_cursor_ai,
    },
    reconcile_zh: pool.reconcile.note_zh,
    reusable_schema_fail_count: reusable_bad.length,
    reusable_schema_fail_sample: reusable_bad.slice(0, 5),
    primary_display_gap: primary_gap,
    g3_b6_unknown_vs_ui_zh:
      primary_gap.sample_100_ai_primary_unknown_count === 0
        ? '試驗 100 在 G3-B AI catalog 內 primary 皆非 unknown；報告「—」多為非 G3-B 列或正式索引空 profile（UI 應顯示未確認）'
        : '試驗 100 仍有 AI primary unknown，需調查',
    no_reclassify_policy: {
      g3_b_sample_100_locked: true,
      reusable_118_skip: true,
      note_zh: '本波僅處理 sample-200.json 內 200 首',
    },
    g3_b1_readonly_mtime_ms: b1_before,
    classification_phase_e_test: {
      exists: phase_e_exists,
      in_npm_test: false,
      recommend_add: phase_e_exists,
    },
    blockers: blockers,
    warnings: warnings,
    safe_to_proceed: blockers.length === 0,
  };
}
