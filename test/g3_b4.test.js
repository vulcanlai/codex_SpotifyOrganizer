/**
 * G3-B.4 批次匯入與合併報告
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { import_g3_b3_batch_from_file } from '../lib/classification/g3_b/batch_import.js';
import {
  FILE_G3_B3_BATCH_PLAN,
  FILE_G3_B3_BATCH_PROGRESS,
  G3_B3_BATCH_DRAFTS_DIR,
} from '../lib/classification/g3_b/paths_b3.js';
import { FILE_G3_B1_AI_DRAFT_READONLY } from '../lib/classification/g3_b/paths_b2.js';
import { build_g3_b4_merged_quality_report } from '../lib/classification/g3_b/merged_quality_report.js';

describe('G3-B.4', { concurrency: 1 }, function () {
  test('20 首批次匯入檔存在', function () {
    const files = fs.readdirSync(G3_B3_BATCH_DRAFTS_DIR).filter(function (f) {
      return f.endsWith('-imported.json');
    });
    let total = 0;
    for (let i = 0; i < files.length; i += 1) {
      const doc = JSON.parse(
        fs.readFileSync(path.join(G3_B3_BATCH_DRAFTS_DIR, files[i]), 'utf8')
      );
      total += doc.tracks.length;
    }
    assert.equal(total, 20);
  });

  test('G3-B.1 草稿未被覆寫', function () {
    const b1 = JSON.parse(fs.readFileSync(FILE_G3_B1_AI_DRAFT_READONLY, 'utf8'));
    const lemon = b1.tracks.find(function (t) {
      return t.track_id === '05B8gt3dCepBPmGe7SPAUo';
    });
    assert.ok(lemon);
    assert.equal(lemon.language.value, '英文');
  });

  test('已完成批次跳過重複匯入', function () {
    const plan = JSON.parse(fs.readFileSync(FILE_G3_B3_BATCH_PLAN, 'utf8'));
    const progress = JSON.parse(fs.readFileSync(FILE_G3_B3_BATCH_PROGRESS, 'utf8'));
    const draft = path.join(
      'backup/classification/g3-b4-trial-30/cursor-drafts/g3b3-batch-02.json'
    );
    const out = import_g3_b3_batch_from_file('g3b3-batch-02', draft, plan, progress);
    assert.equal(out.skipped, true);
  });

  test('合併報告 30 首已處理', function () {
    const r = build_g3_b4_merged_quality_report({ write: false });
    assert.equal(r.counts.ai_processed_total, 30);
    assert.equal(r.counts.newly_generated_g3_b4, 20);
    assert.equal(r.counts.reused_g3_b1, 10);
  });
});
