/**
 * G3-E.1 可追溯 Agent workflow
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'node:path';
import { run_g3_e1 } from '../lib/classification/g3_e/run_g3_e1.js';
import { run_g3_e1_infer, G3E1InferMissingError } from '../lib/classification/g3_e/g3_e1_infer.js';
import { select_g3_e1_pilot_5 } from '../lib/classification/g3_e/g3_e1_sample_5.js';
import { prepare_g3_e1_inputs } from '../lib/classification/g3_e/g3_e1_prepare.js';
import {
  G3_E1_DIR,
  G3_E1_STAGED_DIR,
  FILE_G3_E1_INFER_MANIFEST,
  FILE_G3_E1_INPUT_MANIFEST,
  G3_E1_AGENT_SOURCE,
} from '../lib/classification/g3_e/paths_e1.js';
import { FILE_G3_D4_ADOPT_OVERLAY } from '../lib/classification/g3_d/paths_d4.js';
import { G3_D1_BATCH_DRAFTS_DIR } from '../lib/classification/g3_d/paths_d1.js';
import { build_unified_classification_view } from '../lib/classification/g3_c/build_unified_view.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../lib/enrichment/external/g1_sample.js';

describe('G3-E.1', { concurrency: 1 }, function () {
  test('完整 pipeline 5 首', function () {
    const r = run_g3_e1({ write: true });
    assert.equal(r.summary.pilot_track_count, 5);
    assert.equal(r.validate_report.validate_ok, true);
    assert.equal(r.summary.adopt_executed, false);
    assert.equal(r.summary.adopt_overlay_disabled, true);
    assert.ok(fs.existsSync(G3_E1_DIR));
  });

  test('5 首 input/output hash 對帳', function () {
    run_g3_e1({ write: true });
    const man = JSON.parse(fs.readFileSync(FILE_G3_E1_INFER_MANIFEST, 'utf8'));
    assert.equal(man.entries.length, 5);
    for (let i = 0; i < man.entries.length; i += 1) {
      const e = man.entries[i];
      assert.ok(e.input_hash);
      assert.ok(e.output_hash);
      assert.equal(e.model_api_session_id, null);
      assert.equal(e.provenance_unverified, true);
      const staged = path.join(G3_E1_STAGED_DIR, e.track_id + '-inference.json');
      assert.ok(fs.existsSync(staged));
      const doc = JSON.parse(fs.readFileSync(staged, 'utf8'));
      assert.equal(doc.output_hash, e.output_hash);
      assert.equal(doc.inference.source, G3_E1_AGENT_SOURCE);
    }
  });

  test('source 不能單獨證明 provenance', function () {
    run_g3_e1({ write: true });
    const audit = JSON.parse(
      fs.readFileSync(path.join(G3_E1_DIR, 'audit-provenance-report.json'), 'utf8')
    );
    assert.equal(audit.provenance_unverified_all, true);
    assert.ok(audit.cannot_claim_zh.indexOf('source') >= 0);
  });

  test('sample 5 不重複且含 2 unverified', function () {
    const s = select_g3_e1_pilot_5();
    const ids = s.tracks.map(function (t) {
      return t.track_id;
    });
    assert.equal(new Set(ids).size, 5);
  });

  test('不覆寫 D.1 batch-drafts', function () {
    const files = fs.readdirSync(G3_D1_BATCH_DRAFTS_DIR).filter(function (f) {
      return f.endsWith('-imported.json');
    });
    assert.ok(files.length >= 1);
    run_g3_e1({ write: true });
    assert.ok(fs.existsSync(path.join(G3_D1_BATCH_DRAFTS_DIR, files[0])));
  });

  test('adopt overlay 仍 disabled', function () {
    run_g3_e1({ write: true });
    const ov = JSON.parse(fs.readFileSync(FILE_G3_D4_ADOPT_OVERLAY, 'utf8'));
    assert.equal(ov.enabled, false);
  });

  test('Lemon Tree conflict 保留', function () {
    run_g3_e1({ write: true });
    const doc = build_unified_classification_view({ write: false }).doc;
    assert.equal(doc.tracks[G1_MUST_INCLUDE_LEMON_TREE].auto_review_status, 'conflict');
  });

  test('prepare 後缺 infer 模組列數不符則失敗', function () {
    const sample = select_g3_e1_pilot_5();
    const prep = prepare_g3_e1_inputs(sample, { write: false });
    assert.throws(
      function () {
        run_g3_e1_infer({ tracks: sample.tracks.slice(0, 3), track_count: 3 }, prep.manifest, {
          write: false,
        });
      },
      G3E1InferMissingError
    );
  });
});
