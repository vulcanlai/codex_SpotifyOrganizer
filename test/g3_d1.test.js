/**
 * G3-D.1 第一波 200 首
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { run_g3_d1_pre_execution_check } from '../lib/classification/g3_d/g3_d1_precheck.js';
import { build_expansion_plan_1895 } from '../lib/classification/g3_c/g3_c2_acceptance.js';
import { select_g3_d1_wave_ids } from '../lib/classification/g3_d/g3_d1_stratify.js';
import {
  FILE_G3_D1_SAMPLE_200,
  FILE_G3_D1_BATCH_PLAN,
  G3_D1_CURSOR_DRAFTS_DIR,
  G3_D1_BATCH_DRAFTS_DIR,
  FILE_G3_D1_MERGED_QUALITY,
} from '../lib/classification/g3_d/paths_d1.js';
import { load_g3_b_ai_catalog } from '../lib/classification/g3_c/load_g3_b_ai_catalog.js';
import { FILE_G3_B5_SAMPLE_100 } from '../lib/classification/g3_b/paths_b5.js';
import { build_g3_d1_merged_quality_report } from '../lib/classification/g3_d/merged_quality_report_d1.js';

describe('G3-D.1', { concurrency: 1 }, function () {
  test('執行前對帳（pool 與 G3-C.2 擴大計畫一致）', function () {
    const live = build_expansion_plan_1895();
    const pre = run_g3_d1_pre_execution_check();
    assert.equal(pre.counts.titled, live.titled_track_count);
    assert.equal(pre.counts.g3_b_ai, 100);
    assert.equal(pre.counts.needs_new_ai, live.needs_new_cursor_ai);
    assert.equal(pre.counts.c2_needs_new_ai, live.needs_new_cursor_ai);
    assert.equal(pre.safe_to_proceed, true);
  });

  test('200 首抽樣可重現且不重疊 G3-B 100', function () {
    const a = select_g3_d1_wave_ids(200);
    const b = select_g3_d1_wave_ids(200);
    assert.deepEqual(a.selected_ids, b.selected_ids);
    assert.equal(a.selected_ids.length, 200);
    const sample100 = JSON.parse(fs.readFileSync(FILE_G3_B5_SAMPLE_100, 'utf8')).track_ids;
    const cat = load_g3_b_ai_catalog();
    for (let i = 0; i < a.selected_ids.length; i += 1) {
      const id = a.selected_ids[i];
      assert.ok(sample100.indexOf(id) < 0, id);
      assert.ok(!cat.by_id[id], id);
    }
  });

  test('離線計畫產物存在', function () {
    assert.ok(fs.existsSync(FILE_G3_D1_SAMPLE_200));
    const plan = JSON.parse(fs.readFileSync(FILE_G3_D1_BATCH_PLAN, 'utf8'));
    assert.equal(plan.total_tracks, 200);
    assert.equal(plan.batch_count, 29);
  });

  test('29 批 cursor 草稿與匯入完成', function () {
    const plan = JSON.parse(fs.readFileSync(FILE_G3_D1_BATCH_PLAN, 'utf8'));
    let imported = 0;
    for (let i = 0; i < plan.batches.length; i += 1) {
      const bid = plan.batches[i].batch_id;
      assert.ok(
        fs.existsSync(path.join(G3_D1_CURSOR_DRAFTS_DIR, bid + '.json')),
        bid
      );
      const imp = path.join(G3_D1_BATCH_DRAFTS_DIR, bid + '-imported.json');
      assert.ok(fs.existsSync(imp), imp);
      imported += JSON.parse(fs.readFileSync(imp, 'utf8')).tracks.length;
    }
    assert.equal(imported, 200);
  });

  test('合併報告 200 首', function () {
    const r = build_g3_d1_merged_quality_report({ write: true });
    assert.equal(r.counts.ai_imported_in_wave, 200);
    assert.ok(fs.existsSync(FILE_G3_D1_MERGED_QUALITY));
  });
});
