/**
 * 第六階段 F：品質驗證抽樣（離線）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  select_phase_f_track_ids,
  build_phase_f_sample,
  PHASE_F_SAMPLE_ID,
} from '../lib/classification/phase_f_sample.js';
import {
  FILE_PHASE_F_SAMPLE,
  FILE_PHASE_F_VERIFICATION,
  VERDICT_CORRECT,
  VERDICT_PARTIAL,
  VERDICT_UNDECIDABLE,
  VERDICT_UNSET,
} from '../lib/classification/quality_audit_paths.js';
import {
  save_quality_review,
  load_quality_verification,
} from '../lib/classification/quality_audit_store.js';
import { build_quality_audit_report } from '../lib/classification/quality_audit_report.js';
import { handle_classification_api } from '../lib/classification/web_handlers.js';
import {
  FILE_MANUAL_OVERRIDES,
  FILE_AI_REVIEW_V2,
  FILE_AI_CANDIDATES_V2,
} from '../lib/classification/paths.js';
import { FILE_PHASE_E_CANDIDATES_IMPORTED, FILE_PHASE_E_SAMPLE } from '../lib/classification/ai_test_batches.js';

function file_sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

test('phase-f 抽樣可重現且 20 首不重複', function () {
  assert.ok(fs.existsSync(FILE_PHASE_F_SAMPLE));
  const a = select_phase_f_track_ids({ write: false });
  const b = select_phase_f_track_ids({ write: false });
  assert.deepEqual(a.track_ids, b.track_ids);
  assert.equal(a.track_ids.length, 20);
  const seen = {};
  for (let i = 0; i < a.track_ids.length; i += 1) {
    assert.ok(!seen[a.track_ids[i]]);
    seen[a.track_ids[i]] = true;
  }
  assert.equal(a.sample_id, PHASE_F_SAMPLE_ID);
});

test('phase-f 樣本皆來自 phase-e-100', function () {
  const sample = JSON.parse(fs.readFileSync(FILE_PHASE_E_SAMPLE, 'utf8'));
  const sel = JSON.parse(fs.readFileSync(FILE_PHASE_F_SAMPLE, 'utf8'));
  const set = {};
  for (let i = 0; i < sample.track_ids.length; i += 1) {
    set[sample.track_ids[i]] = true;
  }
  for (let j = 0; j < sel.track_ids.length; j += 1) {
    assert.ok(set[sel.track_ids[j]], sel.track_ids[j]);
  }
  assert.equal(sel.source_test_batch_id, 'phase-e-100');
});

test('phase-f 涵蓋可信度與 unknown 主曲風', function () {
  const sel = select_phase_f_track_ids({ write: false });
  const dist = sel.actual_distribution;
  assert.ok(dist.confidence_tier.high >= 8);
  assert.ok(dist.confidence_tier.medium >= 5);
  assert.equal(dist.unknown_primary, 4);
  assert.ok(dist.non_pop >= 1);
});

test('品質驗證可寫入且與正式審核隔離', async function () {
  const sample = JSON.parse(fs.readFileSync(FILE_PHASE_F_SAMPLE, 'utf8'));
  const id = sample.track_ids[0];
  const mo_before = file_sha256(FILE_MANUAL_OVERRIDES);
  const rv_before = file_sha256(FILE_AI_REVIEW_V2);
  const cand_before = file_sha256(FILE_PHASE_E_CANDIDATES_IMPORTED);

  save_quality_review(
    {
      spotify_id: id,
      verdict: VERDICT_PARTIAL,
      wrong_dimensions: ['primary_genre'],
      note: '測試用',
    },
    { write: true }
  );

  assert.equal(file_sha256(FILE_MANUAL_OVERRIDES), mo_before);
  assert.equal(file_sha256(FILE_AI_REVIEW_V2), rv_before);
  assert.equal(file_sha256(FILE_PHASE_E_CANDIDATES_IMPORTED), cand_before);

  const ver = load_quality_verification();
  assert.equal(ver.reviews_by_track_id[id].verdict, VERDICT_PARTIAL);

  save_quality_review(
    { spotify_id: id, verdict: VERDICT_UNSET },
    { write: true }
  );
  const ver2 = load_quality_verification();
  assert.ok(!ver2.reviews_by_track_id[id]);
});

test('報告：無法判斷不進正確率分母；無人工時不顯示準確率', function () {
  const sample = JSON.parse(fs.readFileSync(FILE_PHASE_F_SAMPLE, 'utf8'));
  for (let i = 0; i < sample.track_ids.length; i += 1) {
    save_quality_review(
      { spotify_id: sample.track_ids[i], verdict: VERDICT_UNSET },
      { write: true }
    );
  }
  save_quality_review(
    {
      spotify_id: sample.track_ids[1],
      verdict: VERDICT_CORRECT,
      wrong_dimensions: [],
      note: '',
    },
    { write: true }
  );
  save_quality_review(
    {
      spotify_id: sample.track_ids[2],
      verdict: VERDICT_UNDECIDABLE,
      wrong_dimensions: [],
      note: '',
    },
    { write: true }
  );
  const report = build_quality_audit_report({ write: false });
  assert.equal(report.rates.has_human_verification, true);
  assert.equal(report.rates.denominator_judged, 1);
  assert.equal(report.verdict_counts.correct, 1);
  assert.equal(report.verdict_counts.undecidable, 1);
  assert.equal(report.rates.correct_pct, 100);
  assert.ok(report.rates.partial_pct === 0 || report.rates.partial_pct === null);

  save_quality_review(
    { spotify_id: sample.track_ids[1], verdict: VERDICT_UNSET },
    { write: true }
  );
  save_quality_review(
    { spotify_id: sample.track_ids[2], verdict: VERDICT_UNSET },
    { write: true }
  );
  const empty_report = build_quality_audit_report({ write: false });
  assert.equal(empty_report.rates.has_human_verification, false);
  assert.equal(empty_report.rates.correct_pct, null);
});

test('API quality-audit 不回寫 v2 候選', async function () {
  const before = file_sha256(FILE_AI_CANDIDATES_V2);
  const status = await handle_classification_api(
    'GET',
    '/api/quality-audit/status',
    '',
    new URLSearchParams()
  );
  assert.equal(status.status, 200);
  assert.equal(file_sha256(FILE_AI_CANDIDATES_V2), before);
});
