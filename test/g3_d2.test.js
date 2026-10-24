/**
 * G3-D.2 品質稽核
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { run_g3_d2_audit } from '../lib/classification/g3_d/g3_d2_audit.js';
import { derive_quality_review } from '../lib/classification/g3_d/auto_review_quality.js';
import { auto_review_ai_draft_row } from '../lib/classification/g3_b/auto_review.js';
import {
  FILE_G3_D2_SUMMARY,
  FILE_G3_D2_QUALITY_OVERLAY,
  FILE_G3_D2_SPOT_CHECK,
  FILE_G3_D2_SOUNDTRACK_AUDIT,
} from '../lib/classification/g3_d/paths_d2.js';
import { load_unified_classification_view } from '../lib/classification/g3_c/build_unified_view.js';

describe('G3-D.2', { concurrency: 1 }, function () {
  test('品質 v2：unknown + low tier', function () {
    const ev = { track_id: 'x', identity: { title: 'T' } };
    const rule = { genre_profile: { primary_genre: 'unknown' } };
    const ai = {
      track_id: 'x',
      title: 'T',
      confidence: 'inferred',
      confidence_tier: 'low',
      genre_profile: {
        primary_genre: 'unknown',
        subgenres: [],
        secondary_genres: [],
        confidence: 'inferred',
      },
      language: {
        value: '未確認',
        confidence: 'unknown',
        vocal_verification_status: 'unverified',
      },
      reason_zh: 'metadata／候選不足；保留 unknown 與未確認',
    };
    const structural = auto_review_ai_draft_row(ev, rule, ai);
    const q = derive_quality_review(structural, ev, rule, ai);
    assert.equal(structural.status, 'pass');
    assert.notEqual(q.quality_status, 'quality_ok');
  });

  test('稽核產物與 overlay', function () {
    const r = run_g3_d2_audit({ write: true });
    assert.equal(r.summary.soundtrack_total, 83);
    assert.equal(r.summary.unknown_total, 72);
    assert.ok(r.summary.v2_quality_review.quality_ok < 200);
    assert.ok(fs.existsSync(FILE_G3_D2_SUMMARY));
    assert.ok(fs.existsSync(FILE_G3_D2_QUALITY_OVERLAY));
    assert.ok(fs.existsSync(FILE_G3_D2_SPOT_CHECK));
    const spot = JSON.parse(fs.readFileSync(FILE_G3_D2_SPOT_CHECK, 'utf8'));
    assert.equal(spot.sample_size, 30);
  });

  test('統一檢視含 quality_status 欄位（D.1 列）', function () {
    run_g3_d2_audit({ write: true });
    const doc = load_unified_classification_view();
    const sample = JSON.parse(
      fs.readFileSync(
        'backup/classification/g3-d1-wave-200/sample-200.json',
        'utf8'
      )
    );
    let with_quality = 0;
    for (let i = 0; i < sample.track_ids.length; i += 1) {
      const row = doc.tracks[sample.track_ids[i]];
      if (row && row.auto_review_quality_status) {
        with_quality += 1;
      }
    }
    assert.equal(with_quality, 200);
  });

  test('soundtrack 稽核分桶存在', function () {
    run_g3_d2_audit({ write: true });
    const st = JSON.parse(fs.readFileSync(FILE_G3_D2_SOUNDTRACK_AUDIT, 'utf8'));
    assert.equal(st.total, 83);
    assert.ok(st.bucket_counts.explicit_scoring_context >= 0);
  });
});
