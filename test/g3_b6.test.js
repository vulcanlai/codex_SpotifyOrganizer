/**
 * G3-B.6 七十首批次匯入與百首合併報告
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { FILE_G3_B5_BATCH_PLAN, FILE_G3_B5_SAMPLE_100 } from '../lib/classification/g3_b/paths_b5.js';
import {
  G3_B6_BATCH_DRAFTS_DIR,
  G3_B6_CURSOR_DRAFTS_DIR,
  FILE_G3_B6_MERGED_QUALITY,
} from '../lib/classification/g3_b/paths_b6.js';
import { build_g3_b6_merged_quality_report_100 } from '../lib/classification/g3_b/merged_quality_report_100.js';
import { FILE_G3_B1_AI_DRAFT_READONLY } from '../lib/classification/g3_b/paths_b2.js';
import { import_g3_b3_batch_from_file } from '../lib/classification/g3_b/batch_import.js';

describe('G3-B.6', { concurrency: 1 }, function () {
  test('70 首批次草稿與匯入存在', function () {
    const plan = JSON.parse(fs.readFileSync(FILE_G3_B5_BATCH_PLAN, 'utf8'));
    assert.equal(plan.batch_count, 10);
    let imported = 0;
    for (let i = 0; i < plan.batches.length; i += 1) {
      const bid = plan.batches[i].batch_id;
      assert.ok(fs.existsSync(path.join(G3_B6_CURSOR_DRAFTS_DIR, bid + '.json')));
      const imp = path.join(G3_B6_BATCH_DRAFTS_DIR, bid + '-imported.json');
      assert.ok(fs.existsSync(imp), imp);
      imported += JSON.parse(fs.readFileSync(imp, 'utf8')).tracks.length;
    }
    assert.equal(imported, 70);
  });

  test('100 首合併報告 ai_processed=100', function () {
    const r = build_g3_b6_merged_quality_report_100({ write: true });
    assert.equal(r.counts.ai_processed_total, 100);
    assert.equal(r.counts.newly_generated_g3_b6, 70);
    assert.equal(r.sample_size, 100);
    assert.ok(fs.existsSync(FILE_G3_B6_MERGED_QUALITY));
  });

  test('G3-B.1 草稿未被覆寫', function () {
    const b1 = JSON.parse(fs.readFileSync(FILE_G3_B1_AI_DRAFT_READONLY, 'utf8'));
    const lemon = b1.tracks.find(function (t) {
      return t.track_id === '05B8gt3dCepBPmGe7SPAUo';
    });
    assert.ok(lemon);
    assert.equal(lemon.language.value, '英文');
  });

  test('已完成 g3b5 批次跳過重複匯入', function () {
    const plan = JSON.parse(fs.readFileSync(FILE_G3_B5_BATCH_PLAN, 'utf8'));
    const progress = JSON.parse(
      fs.readFileSync('backup/classification/g3-b5-trial-100/batch-progress-100.json', 'utf8')
    );
    const draft = path.join(G3_B6_CURSOR_DRAFTS_DIR, 'g3b5-batch-01.json');
    const out = import_g3_b3_batch_from_file('g3b5-batch-01', draft, plan, progress, {
      batch_drafts_dir: G3_B6_BATCH_DRAFTS_DIR,
      batch_import_log: path.join(G3_B6_BATCH_DRAFTS_DIR, '../batch-import-log.json'),
      batch_progress_file: 'backup/classification/g3-b5-trial-100/batch-progress-100.json',
    });
    assert.equal(out.skipped, true);
  });

  test('sample-100 與匯入 ID 對齊', function () {
    const sample = JSON.parse(fs.readFileSync(FILE_G3_B5_SAMPLE_100, 'utf8'));
    const r = build_g3_b6_merged_quality_report_100({ write: false });
    assert.equal(r.per_track.length, 100);
    for (let i = 0; i < sample.track_ids.length; i += 1) {
      assert.ok(
        r.per_track.some(function (p) {
          return p.track_id === sample.track_ids[i];
        })
      );
    }
  });
});
