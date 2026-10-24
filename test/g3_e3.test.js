/**
 * G3-E.3 剩餘 unverified JSON 批次
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'node:path';
import { build_g3_e3_reconciliation, select_g3_e3_wave } from '../lib/classification/g3_e/g3_e3_reconcile.js';
import { prepare_g3_e3, run_g3_e3 } from '../lib/classification/g3_e/run_g3_e3.js';
import { load_g3_e_batch_agent_output, G3EAgentOutputMissingError } from '../lib/classification/g3_e/g3_e_load_agent_json.js';
import { g3_e3_wave_spec } from '../lib/classification/g3_e/g3_e_wave_spec.js';
import { prepare_g3_e_batch_inputs } from '../lib/classification/g3_e/g3_e_prepare_batches.js';
import {
  G3_E3_WAVE_DIR,
  G3_E3_STAGED_DIR,
  FILE_G3_E3_PROGRESS,
  G3_E3_AGENT_SOURCE,
  G3_E3_AGENT_METHOD,
} from '../lib/classification/g3_e/paths_e3.js';
import { G3_D1_BATCH_DRAFTS_DIR } from '../lib/classification/g3_d/paths_d1.js';
import { FILE_G3_D4_ADOPT_OVERLAY } from '../lib/classification/g3_d/paths_d4.js';
import { G3_E2_WAVE_DIR } from '../lib/classification/g3_e/paths_e2.js';
import { G3_E1_DIR } from '../lib/classification/g3_e/paths_e1.js';
import { build_unified_classification_view } from '../lib/classification/g3_c/build_unified_view.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../lib/enrichment/external/g1_sample.js';
import { run_g3_e2 } from '../lib/classification/g3_e/run_g3_e2.js';

describe('G3-E.3', { concurrency: 1 }, function () {
  test('對帳：140 unverified = E.1∩ + E.2 + 剩餘 118', function () {
    const r = build_g3_e3_reconciliation();
    assert.equal(r.d5_provenance_unverified_count, 140);
    assert.equal(r.e2_wave_count, 20);
    assert.equal(r.e1_in_d5_unverified.length, 2);
    assert.equal(r.remainder_count, 118);
    assert.equal(r.integrity.accounting_check, true);
  });

  test('wave 118 首 ID 不重複', function () {
    const wave = select_g3_e3_wave();
    const ids = wave.tracks.map(function (t) {
      return t.track_id;
    });
    assert.equal(ids.length, 118);
    assert.equal(new Set(ids).size, 118);
    assert.equal(wave.batch_count, 12);
  });

  test('prepare 輸入不含 review_only 舊 AI 建議', function () {
    prepare_g3_e3({ write: true });
    const spec = g3_e3_wave_spec();
    const doc = JSON.parse(
      fs.readFileSync(
        path.join(spec.batch_inputs_dir, 'g3e3-batch-01-input.json'),
        'utf8'
      )
    );
    assert.equal(doc.infer_isolation, 'e3_no_legacy_ai_in_input');
    assert.equal(doc.tracks[0].review_only_suggestions, null);
  });

  test('有 Agent JSON 時可 stage；缺 batch-03 則 halted', function () {
    const r = run_g3_e3({ write: true });
    assert.ok(r.summary.staged_count >= 20);
    assert.equal(r.summary.validate_success, r.summary.staged_count);
    assert.equal(r.summary.adopt_disabled, true);
    if (r.summary.staged_count < 118) {
      assert.equal(r.summary.halted, true);
      assert.ok(r.summary.halt_reason_zh.indexOf('g3e3-batch-03') >= 0);
    }
  });

  test('續跑不重複 ingest 已完成首', function () {
    run_g3_e3({ write: true });
    const again = run_g3_e3({ write: true });
    assert.equal(again.summary.agent_json_new_count, 0);
    assert.equal(again.summary.staged_count, again.summary.validate_success);
  });

  test('缺 Agent 輸出 fail-closed', function () {
    const wave = select_g3_e3_wave();
    const spec = g3_e3_wave_spec();
    const prep = prepare_g3_e_batch_inputs(wave, spec, { write: false });
    const progress = { tracks: {}, batches: {} };
    const input_hash_by_id = {};
    const batch_in = prep.batch_inputs[2];
    for (let t = 0; t < batch_in.tracks.length; t += 1) {
      input_hash_by_id[batch_in.tracks[t].track_id] = batch_in.tracks[t].input_hash;
    }
    assert.throws(
      function () {
        load_g3_e_batch_agent_output(
          spec,
          'g3e3-batch-nonexistent',
          batch_in.tracks.map(function (x) {
            return x.track_id;
          }),
          input_hash_by_id,
          progress
        );
      },
      G3EAgentOutputMissingError
    );
  });

  test('staged 含 E.3 source/method', function () {
    run_g3_e3({ write: true });
    const wave = select_g3_e3_wave();
    const id = wave.tracks[0].track_id;
    const staged_path = path.join(G3_E3_STAGED_DIR, id + '-staged.json');
    if (fs.existsSync(staged_path)) {
      const doc = JSON.parse(fs.readFileSync(staged_path, 'utf8'));
      assert.equal(doc.inference.source, G3_E3_AGENT_SOURCE);
      assert.equal(doc.inference.method, G3_E3_AGENT_METHOD);
      assert.equal(doc.inference.provenance.provenance_unverified, true);
    }
  });

  test('不覆寫 D.1/E.1/E.2 與 adopt disabled', function () {
    const d1 = fs.readdirSync(G3_D1_BATCH_DRAFTS_DIR).filter(function (f) {
      return f.endsWith('-imported.json');
    })[0];
    run_g3_e3({ write: true });
    run_g3_e2({ write: true });
    assert.ok(fs.existsSync(path.join(G3_D1_BATCH_DRAFTS_DIR, d1)));
    assert.ok(fs.existsSync(G3_E1_DIR));
    assert.ok(fs.existsSync(G3_E2_WAVE_DIR));
    const ov = JSON.parse(fs.readFileSync(FILE_G3_D4_ADOPT_OVERLAY, 'utf8'));
    assert.equal(ov.enabled, false);
  });

  test('Lemon Tree conflict 保留', function () {
    run_g3_e3({ write: true });
    const doc = build_unified_classification_view({ write: false }).doc;
    assert.equal(doc.tracks[G1_MUST_INCLUDE_LEMON_TREE].auto_review_status, 'conflict');
  });

  test('batch-progress 記錄已完成批', function () {
    run_g3_e3({ write: true });
    const prog = JSON.parse(fs.readFileSync(FILE_G3_E3_PROGRESS, 'utf8'));
    assert.equal(prog.batches['g3e3-batch-01'].status, 'completed');
    assert.equal(prog.batches['g3e3-batch-02'].status, 'completed');
    assert.ok(fs.existsSync(G3_E3_WAVE_DIR));
  });
});
