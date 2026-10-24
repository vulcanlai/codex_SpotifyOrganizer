/**
 * 第六階段 E：100 首測試批次（離線）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { build_classification_index } from '../lib/classification/build_index.js';
import { export_phase_e_sample } from '../lib/classification/phase_e_export.js';
import {
  FILE_AI_SAMPLE,
  FILE_AI_CANDIDATES_V2,
  FILE_AI_REVIEW_V2,
  FILE_MANUAL_OVERRIDES,
} from '../lib/classification/paths.js';
import {
  FILE_PHASE_E_SAMPLE,
  FILE_PHASE_E_CANDIDATES_IMPORTED,
  TEST_BATCH_PHASE_E_100,
  TEST_BATCH_V2_30,
  get_test_batch_config,
  PHASE_E_PARTIAL_CANDIDATES_DIR,
} from '../lib/classification/ai_test_batches.js';
import path from 'node:path';
import {
  merge_phase_e_partial_candidates,
  import_phase_e_candidates,
} from '../lib/classification/phase_e_import.js';
import { build_phase_e_quality_report } from '../lib/classification/ai_quality_report.js';
import { plan_batch_review } from '../lib/classification/ai_batch_review.js';
import { handle_classification_api } from '../lib/classification/web_handlers.js';
import { normalize_ai_candidates_v2_doc, validate_ai_candidates_v2_doc } from '../lib/classification/ai_validate.js';
import { compute_confidence_tier } from '../lib/classification/confidence_tier.js';

function file_sha256(path) {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
}

function minimal_candidate(spotify_id) {
  return {
    spotify_id,
    language: {
      value: '未確認',
      confidence: 'unknown',
      evidence: '測試用：語言未確認',
      method: 'test',
      source: 'test',
    },
    genre_profile: {
      primary_genre: {
        value: 'unknown',
        confidence: 'unknown',
        evidence: '測試用：證據不足故 unknown',
        method: 'test',
        source: 'test',
      },
      secondary_genres: [],
      subgenres: [],
    },
    moods: [],
    special_types: [],
  };
}

test('phase-e 樣本選取可重現且排除 v2 30 首', function () {
  const built = build_classification_index({ write: false });
  const v2 = JSON.parse(fs.readFileSync(FILE_AI_SAMPLE, 'utf8'));
  const a = export_phase_e_sample({
    write: false,
    index_doc: built.index_doc,
    count: 100,
    exclude_ids: v2.track_ids,
  });
  const b = export_phase_e_sample({
    write: false,
    index_doc: built.index_doc,
    count: 100,
    exclude_ids: v2.track_ids,
  });
  assert.equal(a.ok, true);
  assert.deepEqual(a.sample_doc.track_ids, b.sample_doc.track_ids);
  assert.equal(a.sample_doc.track_count, 100);
  const set = new Set(a.sample_doc.track_ids);
  assert.equal(set.size, 100);
  for (let i = 0; i < v2.track_ids.length; i += 1) {
    assert.equal(set.has(v2.track_ids[i]), false);
  }
});

test('phase-e 與 v2 審核檔案路徑獨立', function () {
  const v2cfg = get_test_batch_config(TEST_BATCH_V2_30);
  const ecfg = get_test_batch_config(TEST_BATCH_PHASE_E_100);
  assert.notEqual(v2cfg.review_file, ecfg.review_file);
  assert.notEqual(v2cfg.candidates_imported_file, ecfg.candidates_imported_file);
});

test('partial 合併與匯入 idempotent', function () {
  if (!fs.existsSync(FILE_PHASE_E_SAMPLE)) {
    return;
  }
  const sample = JSON.parse(fs.readFileSync(FILE_PHASE_E_SAMPLE, 'utf8'));
  const id = sample.track_ids[0];
  fs.mkdirSync(PHASE_E_PARTIAL_CANDIDATES_DIR, { recursive: true });
  const part_path = path.join(PHASE_E_PARTIAL_CANDIDATES_DIR, 't-test.json');
  fs.writeFileSync(
    part_path,
    JSON.stringify({ candidates: [minimal_candidate(id)] }) + '\n',
    'utf8'
  );
  const merged = merge_phase_e_partial_candidates({ write: true });
  assert.equal(merged.merged_count >= 1, true);
  const norm = normalize_ai_candidates_v2_doc(merged.draft);
  validate_ai_candidates_v2_doc(norm, sample, { allow_partial: true });
  const before = fs.existsSync(FILE_PHASE_E_CANDIDATES_IMPORTED)
    ? file_sha256(FILE_PHASE_E_CANDIDATES_IMPORTED)
    : null;
  const r1 = import_phase_e_candidates({ write: true });
  const r2 = import_phase_e_candidates({ write: true });
  if (r1.imported) {
    assert.equal(r2.idempotent, true);
  }
  fs.unlinkSync(part_path);
});

test('品質報告區分已完成與待分類', function () {
  if (!fs.existsSync(FILE_PHASE_E_SAMPLE)) {
    return;
  }
  const report = build_phase_e_quality_report({ write: false });
  assert.ok(report.classification_status);
  assert.equal(
    report.classification_status.ai_completed +
      report.classification_status.ai_pending,
    report.sample_track_count
  );
  assert.ok(report.accuracy_note.indexOf('準確率') >= 0);
});

test('批次審核上限 30（phase-e）', function () {
  if (!fs.existsSync(FILE_PHASE_E_SAMPLE)) {
    return;
  }
  const sample = JSON.parse(fs.readFileSync(FILE_PHASE_E_SAMPLE, 'utf8'));
  const plan = plan_batch_review({
    test_batch_id: TEST_BATCH_PHASE_E_100,
    action: 'reject',
    track_ids: sample.track_ids.slice(0, 31),
    candidate_version: 2,
  });
  assert.equal(plan.ok, false);
});

test('API：/api/ai/batches 離線可用', async function () {
  const res = await handle_classification_api(
    'GET',
    '/api/ai/batches',
    '',
    new URLSearchParams()
  );
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.batches.length >= 2);
});

test('v2 審核檔 hash 不因 phase-e 匯出改變', function () {
  if (!fs.existsSync(FILE_AI_REVIEW_V2)) {
    return;
  }
  const before = file_sha256(FILE_AI_REVIEW_V2);
  export_phase_e_sample({ write: false, count: 100 });
  const after = file_sha256(FILE_AI_REVIEW_V2);
  assert.equal(before, after);
});

test('manual-overrides 不因 phase-e 品質報告改變', function () {
  const before = file_sha256(FILE_MANUAL_OVERRIDES);
  build_phase_e_quality_report({ write: false });
  const after = file_sha256(FILE_MANUAL_OVERRIDES);
  assert.equal(before, after);
});

test('unknown 主曲風可信度為 low', function () {
  const tier = compute_confidence_tier({
    candidate: minimal_candidate('x'),
    index_row: { metadata_status: 'complete' },
  });
  assert.equal(tier.tier, 'low');
});
