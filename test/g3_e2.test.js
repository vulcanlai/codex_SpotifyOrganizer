/**
 * G3-E.2 JSON 批次 Agent 分類（20 首）
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'node:path';
import { run_g3_e2 } from '../lib/classification/g3_e/run_g3_e2.js';
import { select_g3_e2_wave_20 } from '../lib/classification/g3_e/g3_e2_sample_20.js';
import { prepare_g3_e2_batch_inputs } from '../lib/classification/g3_e/g3_e2_prepare_batches.js';
import {
  load_g3_e2_batch_agent_output,
  G3E2AgentOutputMissingError,
} from '../lib/classification/g3_e/g3_e2_load_agent_json.js';
import {
  G3_E2_WAVE_DIR,
  G3_E2_STAGED_DIR,
  FILE_G3_E2_PROGRESS,
  G3_E2_EXCLUDE_E1_IDS,
  G3_E2_AGENT_SOURCE,
  G3_E2_AGENT_METHOD,
} from '../lib/classification/g3_e/paths_e2.js';
import { G3_E1_DIR, FILE_G3_E1_INFER_MANIFEST } from '../lib/classification/g3_e/paths_e1.js';
import { G3_D1_BATCH_DRAFTS_DIR } from '../lib/classification/g3_d/paths_d1.js';
import { FILE_G3_D4_ADOPT_OVERLAY } from '../lib/classification/g3_d/paths_d4.js';
import { build_unified_classification_view } from '../lib/classification/g3_c/build_unified_view.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../lib/enrichment/external/g1_sample.js';

describe('G3-E.2', { concurrency: 1 }, function () {
  test('完整 pipeline 20 首（需 agent-outputs JSON）', function () {
    const r = run_g3_e2({ write: true });
    assert.equal(r.summary.wave_track_count, 20);
    assert.equal(r.summary.validate_fail, 0);
    assert.equal(r.summary.staged_count, 20);
    assert.equal(r.summary.halted, false);
    assert.equal(r.summary.adopt_disabled, true);
    assert.ok(fs.existsSync(G3_E2_WAVE_DIR));
  });

  test('20 首不含 E.1 五首', function () {
    const wave = select_g3_e2_wave_20();
    const ids = wave.tracks.map(function (t) {
      return t.track_id;
    });
    assert.equal(ids.length, 20);
    for (let i = 0; i < G3_E2_EXCLUDE_E1_IDS.length; i += 1) {
      assert.ok(ids.indexOf(G3_E2_EXCLUDE_E1_IDS[i]) < 0);
    }
  });

  test('續跑：已成功且 input 未變則不重新計入 agent_json_new', function () {
    run_g3_e2({ write: true });
    const again = run_g3_e2({ write: true });
    assert.equal(again.summary.staged_count, 20);
    assert.equal(again.summary.agent_json_new_count, 0);
    assert.equal(again.summary.validate_success, 20);
  });

  test('缺 Agent 輸出檔 fail-closed', function () {
    const wave = select_g3_e2_wave_20();
    const prep = prepare_g3_e2_batch_inputs(wave, { write: false });
    const progress = { tracks: {}, batches: {} };
    const input_hash_by_id = {};
    const batch_in = prep.batch_inputs[0];
    for (let t = 0; t < batch_in.tracks.length; t += 1) {
      input_hash_by_id[batch_in.tracks[t].track_id] = batch_in.tracks[t].input_hash;
    }
    assert.throws(
      function () {
        load_g3_e2_batch_agent_output(
          'g3e2-batch-missing-test',
          batch_in.tracks.map(function (x) {
            return x.track_id;
          }),
          input_hash_by_id,
          progress
        );
      },
      G3E2AgentOutputMissingError
    );
  });

  test('input_hash 變更禁止 silent 沿用', function () {
    const wave = select_g3_e2_wave_20();
    const prep = prepare_g3_e2_batch_inputs(wave, { write: false });
    const batch = wave.batches[0];
    const input_hash_by_id = {};
    const tid = batch.track_ids[0];
    for (let b = 0; b < prep.batch_inputs.length; b += 1) {
      const bi = prep.batch_inputs[b];
      for (let t = 0; t < bi.tracks.length; t += 1) {
        input_hash_by_id[bi.tracks[t].track_id] = bi.tracks[t].input_hash;
      }
    }
    const progress = {
      tracks: {
        [tid]: {
          input_hash: 'deadbeef',
          output_hash: 'abc',
          validation_status: 'ok',
          stage_status: 'staged',
        },
      },
      batches: {},
    };
    assert.throws(function () {
      load_g3_e2_batch_agent_output(batch.batch_id, batch.track_ids, input_hash_by_id, progress);
    }, /input_hash 已變更/);
  });

  test('staged 含 source/method 與 provenance_unverified', function () {
    run_g3_e2({ write: true });
    const wave = select_g3_e2_wave_20();
    const id = wave.tracks[0].track_id;
    const doc = JSON.parse(
      fs.readFileSync(path.join(G3_E2_STAGED_DIR, id + '-staged.json'), 'utf8')
    );
    assert.equal(doc.inference.source, G3_E2_AGENT_SOURCE);
    assert.equal(doc.inference.method, G3_E2_AGENT_METHOD);
    assert.equal(doc.inference.provenance.provenance_unverified, true);
    assert.equal(doc.inference.provenance.model_api_session_id, null);
    assert.ok(doc.input_hash);
    assert.ok(doc.output_hash);
  });

  test('不覆寫 D.1 batch-drafts 與 E.1 pilot', function () {
    const d1_files = fs.readdirSync(G3_D1_BATCH_DRAFTS_DIR).filter(function (f) {
      return f.endsWith('-imported.json');
    });
    const e1_manifest_before = fs.readFileSync(FILE_G3_E1_INFER_MANIFEST, 'utf8');
    run_g3_e2({ write: true });
    assert.ok(fs.existsSync(path.join(G3_D1_BATCH_DRAFTS_DIR, d1_files[0])));
    assert.equal(fs.readFileSync(FILE_G3_E1_INFER_MANIFEST, 'utf8'), e1_manifest_before);
    assert.ok(fs.existsSync(G3_E1_DIR));
  });

  test('adopt overlay 仍 disabled', function () {
    run_g3_e2({ write: true });
    const ov = JSON.parse(fs.readFileSync(FILE_G3_D4_ADOPT_OVERLAY, 'utf8'));
    assert.equal(ov.enabled, false);
  });

  test('Lemon Tree conflict 保留', function () {
    run_g3_e2({ write: true });
    const doc = build_unified_classification_view({ write: false }).doc;
    assert.equal(doc.tracks[G1_MUST_INCLUDE_LEMON_TREE].auto_review_status, 'conflict');
  });

  test('batch-progress 記錄四批 completed', function () {
    run_g3_e2({ write: true });
    const prog = JSON.parse(fs.readFileSync(FILE_G3_E2_PROGRESS, 'utf8'));
    assert.equal(Object.keys(prog.tracks).length, 20);
    assert.equal(prog.batches['g3e2-batch-01'].status, 'completed');
    assert.equal(prog.batches['g3e2-batch-04'].status, 'completed');
  });
});
