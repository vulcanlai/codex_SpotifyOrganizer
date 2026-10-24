/**
 * G3-D.5 採用前驗收
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { run_g3_d5 } from '../lib/classification/g3_d/run_g3_d5.js';
import { reconcile_d1_d3_d4 } from '../lib/classification/g3_d/g3_d4_reconcile.js';
import {
  G3_D5_DIR,
  FILE_G3_D5_PROVENANCE,
  FILE_G3_D5_ELIGIBILITY,
  FILE_G3_D5_ADOPT_DRY_RUN,
  FILE_G3_D5_OFFLINE_SUMMARY,
} from '../lib/classification/g3_d/paths_d5.js';
import { FILE_G3_D4_ADOPT_OVERLAY } from '../lib/classification/g3_d/paths_d4.js';

describe('G3-D.5', { concurrency: 1 }, function () {
  test('200 首 provenance 與 eligibility 對帳', function () {
    const r = run_g3_d5({ write: true });
    assert.equal(r.provenance.track_count, 200);
    assert.equal(r.eligibility.counts.total, 200);
    const sum =
      r.eligibility.counts.A +
      r.eligibility.counts.B +
      r.eligibility.counts.C +
      r.eligibility.counts.D;
    assert.equal(sum, 200);
    assert.equal(r.spot.track_count, 40);
    assert.ok(fs.existsSync(G3_D5_DIR));
  });

  test('140 首 batch 04–17 標記 provenance_unverified', function () {
    const doc = JSON.parse(fs.readFileSync(FILE_G3_D5_PROVENANCE, 'utf8'));
    assert.equal(doc.summary.provenance_unverified, 140);
    assert.equal(doc.summary.attested_module_no_session_log, 60);
  });

  test('adopt overlay 仍 disabled 且 dry-run 可撤回', function () {
    run_g3_d5({ write: true });
    const ov = JSON.parse(fs.readFileSync(FILE_G3_D4_ADOPT_OVERLAY, 'utf8'));
    assert.equal(ov.enabled, false);
    const dr = JSON.parse(fs.readFileSync(FILE_G3_D5_ADOPT_DRY_RUN, 'utf8'));
    assert.equal(dr.enabled, false);
    assert.equal(dr.rollback_test.pass, true);
    assert.equal(dr.lemon_tree.conflict_preserved, true);
    assert.equal(dr.confirmed_tier_leak_count, 0);
  });

  test('recommend 不建議啟用 adopt', function () {
    const s = JSON.parse(fs.readFileSync(FILE_G3_D5_OFFLINE_SUMMARY, 'utf8'));
    assert.equal(s.recommend_enable_adopt, false);
  });

  test('D.1 200 ID 全覆蓋 eligibility', function () {
    const rec = reconcile_d1_d3_d4();
    const el = JSON.parse(fs.readFileSync(FILE_G3_D5_ELIGIBILITY, 'utf8'));
    const all = el.lists.A.concat(el.lists.B, el.lists.C, el.lists.D);
    assert.equal(all.length, 200);
    const set = {};
    for (let i = 0; i < all.length; i += 1) {
      assert.ok(!set[all[i]]);
      set[all[i]] = true;
      assert.ok(rec.d1_track_ids.indexOf(all[i]) >= 0);
    }
  });
});
