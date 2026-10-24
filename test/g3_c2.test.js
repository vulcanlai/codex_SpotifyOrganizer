/**
 * G3-C.2 驗收
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { run_g3_c2_acceptance } from '../lib/classification/g3_c/run_g3_c2_acceptance.js';
import {
  analyze_sample_100_preview_gap,
  build_expansion_plan_1895,
} from '../lib/classification/g3_c/g3_c2_acceptance.js';
import { FILE_G3_C2_PREVIEW_GAP, FILE_G3_C2_EXPANSION_PLAN } from '../lib/classification/g3_c/paths_c2.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../lib/enrichment/external/g1_sample.js';

describe('G3-C.2', { concurrency: 1 }, function () {
  test('100 首 10 首排除為 balanced low tier', function () {
    const gap = analyze_sample_100_preview_gap();
    assert.equal(gap.sample_total, 100);
    assert.equal(gap.included_in_balanced_empty_filter, 90);
    assert.equal(gap.excluded_count, 10);
    assert.equal(gap.data_loss_detected, false);
    for (let i = 0; i < gap.excluded_tracks.length; i += 1) {
      assert.equal(gap.excluded_tracks[i].exclusion_category, 'balanced_policy_low_confidence_tier');
      assert.equal(gap.excluded_tracks[i].ai_confidence_tier, 'low');
    }
  });

  test('Lemon Tree 在 balanced 預覽內且 conflict 保留', function () {
    const gap = analyze_sample_100_preview_gap();
    assert.ok(gap.included_track_ids.indexOf(G1_MUST_INCLUDE_LEMON_TREE) >= 0);
    const r = run_g3_c2_acceptance({ write: false });
    assert.equal(r.audit.lemon_tree_conflict_preserved, true);
  });

  test('擴大計畫對帳（即時有曲名母體）', function () {
    const live = build_expansion_plan_1895();
    const r = run_g3_c2_acceptance({ write: true });
    assert.equal(r.expansion.titled_track_count, live.titled_track_count);
    assert.equal(r.expansion.g3_b_classified_count, 100);
    assert.equal(r.expansion.needs_new_cursor_ai, live.needs_new_cursor_ai);
    assert.ok(r.expansion.needs_new_cursor_ai > 0);
    assert.ok(
      r.expansion.needs_new_cursor_ai <= live.titled_track_count - r.expansion.g3_b_classified_count
    );
    assert.ok(fs.existsSync(FILE_G3_C2_EXPANSION_PLAN));
  });

  test('篩選 smoke 通過', function () {
    const r = run_g3_c2_acceptance({ write: false });
    assert.equal(r.summary.filter_smoke_all_ok, true);
  });

  test('產物寫入 g3-c2-acceptance', function () {
    run_g3_c2_acceptance({ write: true });
    assert.ok(fs.existsSync(FILE_G3_C2_PREVIEW_GAP));
  });
});
