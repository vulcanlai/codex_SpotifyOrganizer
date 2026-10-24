/**
 * G3-B.3 重用、欄位任務、批次續跑
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collect_ai_result_records_for_track,
  build_evidence_fingerprint,
} from '../lib/classification/g3_b/ai_result_catalog.js';
import {
  resolve_reuse_for_track,
  should_regenerate,
} from '../lib/classification/g3_b/ai_result_reuse.js';
import { build_batch_plan, is_batch_completed, apply_batch_import_result } from '../lib/classification/g3_b/batch_plan.js';
import { import_batch_tracks_safe } from '../lib/classification/g3_b/batch_import.js';
import { build_field_tasks_for_track } from '../lib/classification/g3_b/field_evidence_tasks.js';
import { run_g3_b3_offline_eval } from '../lib/classification/g3_b/run_b3_offline_eval.js';
import { REVIEW_CONFLICT } from '../lib/classification/g3_b/auto_review.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../lib/enrichment/external/g1_sample.js';
import { GENRE_TAXONOMY_VERSION } from '../lib/classification/paths.js';
import { resolve_human_confirmation } from '../lib/classification/g3_evidence/human_confirmation.js';

describe('G3-B.3', { concurrency: 1 }, function () {
  test('不同來源候選去重保留優先序', function () {
    const records = [
      { source: 'v2-30', reusable: true, primary_genre: 'pop' },
      { source: 'g3_b1_ai_draft', reusable: true, primary_genre: 'pop' },
    ];
    const reuse = resolve_reuse_for_track(
      't1',
      { records: records },
      { genre_profile: { primary_genre: 'unknown' } },
      {}
    );
    assert.equal(reuse.best_record.source, 'g3_b1_ai_draft');
  });

  test('字典版本變更觸發重新分類', function () {
    const r = should_regenerate({ taxonomy_version: GENRE_TAXONOMY_VERSION - 1 });
    assert.equal(r.regen, true);
  });

  test('人工確認優先不可重用為自動採納', function () {
    const h = resolve_human_confirmation('h1', {
      index_row: { tags: [{ is_manual_override: true }] },
      overrides_doc: { overrides_by_track_id: {} },
    });
    assert.equal(h.locked, true);
  });

  test('Lemon Tree 欄位任務保留 G3-B.1 語言與曲風', function () {
    const tasks = build_field_tasks_for_track(
      G1_MUST_INCLUDE_LEMON_TREE,
      {
        status: REVIEW_CONFLICT,
        issues: ['與 fixture 不符'],
        needs_human_decision: true,
      },
      {
        language: { value: '英文' },
        genre_profile: { primary_genre: 'pop', subgenres: ['synth_pop'] },
      },
      { track_id: G1_MUST_INCLUDE_LEMON_TREE, identity: { title: 'Lemon Tree' } }
    );
    assert.ok(tasks.length >= 1);
    const lang_task = tasks.find(function (t) {
      return t.field === 'vocal_language';
    });
    assert.ok(lang_task.preserve_g3_b1_original);
    assert.equal(lang_task.preserve_g3_b1_original.language_value, '英文');
    assert.ok(lang_task.genre_preserved.primary_genre === 'pop');
    assert.equal(lang_task.project_fixture_hint.not_formal_human_confirmation, true);
  });

  test('批次中斷續跑辨識已完成', function () {
    const plan = build_batch_plan(['a', 'b', 'c', 'd', 'e', 'f'], 2);
    let progress = { batches: plan.batches.map(function (b) {
      return { batch_id: b.batch_id, status: 'pending', imported_track_ids: [], failed: [] };
    }), completed_batch_ids: [] };
    progress = apply_batch_import_result(progress, 'g3b3-batch-01', {
      imported_track_ids: ['a', 'b'],
      failed: [],
      batch_failed: false,
    });
    assert.equal(is_batch_completed(progress, 'g3b3-batch-01'), true);
  });

  test('部分失敗恢復', function () {
    const result = import_batch_tracks_safe(
      {
        tracks: [
          {
            track_id: 'bad-id-not-in-allowed',
            confidence: 'inferred',
            genre_profile: { primary_genre: 'pop', confidence: 'inferred' },
            language: {
              value: '未確認',
            },
          },
          {
            track_id: 'okid1234567890123456789012',
            confidence: 'inferred',
            genre_profile: { primary_genre: 'pop', confidence: 'inferred' },
            language: { value: '未確認' },
          },
        ],
      },
      {
        allowed_track_ids: ['okid1234567890123456789012'],
        output_path: null,
      }
    );
    assert.equal(result.imported_track_ids.length, 1);
    assert.equal(result.failed.length, 1);
  });

  test('離線評估不修改 G3-B.1 草稿 mtime', function () {
    const p = 'backup/classification/g3-b-trial-30/ai-classification-draft.json';
    if (!fs.existsSync(p)) {
      return;
    }
    const before = fs.statSync(p).mtimeMs;
    run_g3_b3_offline_eval({ write: true });
    const after = fs.statSync(p).mtimeMs;
    assert.equal(before, after);
  });

  test('G3-B.1 十首不在 still-needs-generation', function () {
    if (!fs.existsSync('backup/classification/g3-b3-trial-30/offline-summary.json')) {
      run_g3_b3_offline_eval({ write: true });
    }
    const summary = JSON.parse(
      fs.readFileSync('backup/classification/g3-b3-trial-30/offline-summary.json', 'utf8')
    );
    assert.equal(summary.g3_b1_erroneously_in_generation_queue, 0);
  });

  test('evidence fingerprint 穩定格式', function () {
    const fp = build_evidence_fingerprint({ classification_index: 'abc' });
    assert.equal(typeof fp, 'string');
    assert.equal(fp.length, 16);
  });
});
