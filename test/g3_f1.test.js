/**
 * G3-F.1
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'node:path';
import {
  dry_run_g3_f1_reconcile,
  prepare_g3_f1,
  run_g3_f1,
} from '../lib/classification/g3_f/run_g3_f1.js';
import { select_g3_f1_wave } from '../lib/classification/g3_f/g3_f1_wave_select.js';
import { build_g3_f1_pending_queue } from '../lib/classification/g3_f/g3_f1_queue.js';
import { build_g3_f1_context } from '../lib/classification/g3_f/g3_f1_context.js';
import { g3_f1_wave_spec } from '../lib/classification/g3_f/g3_f1_wave_spec.js';
import { G3_F1_WAVE_DIR, G3_F1_AGENT_SOURCE, G3_F1_AGENT_METHOD } from '../lib/classification/g3_f/paths_f1.js';
import { FILE_G3_D4_ADOPT_OVERLAY } from '../lib/classification/g3_d/paths_d4.js';

describe('G3-F.1', { concurrency: 1 }, function () {
  test('dry reconcile 7759 且互斥加總正確', function () {
    const r = dry_run_g3_f1_reconcile();
    assert.equal(r.reconciliation.universe.library_index_ids, 7759);
    assert.equal(r.reconciliation.exclusive_primary_states.matches_universe, true);
    assert.ok(r.timing_ms.total < 120000, 'reconcile 應在合理時間內完成');
    assert.ok(r.queue.pending_count >= 100);
  });

  test('wave 100 固定 seed', function () {
    const q = build_g3_f1_pending_queue(build_g3_f1_context());
    const a = select_g3_f1_wave(q);
    const b = select_g3_f1_wave(q);
    assert.deepEqual(
      a.tracks.map(function (t) {
        return t.track_id;
      }),
      b.tracks.map(function (t) {
        return t.track_id;
      })
    );
    assert.equal(a.track_count, 100);
  });

  test('prepare 輸入不含舊 AI 建議', function () {
    prepare_g3_f1({ write: true, input_batch_limit: 1 });
    const spec = g3_f1_wave_spec();
    const doc = JSON.parse(
      fs.readFileSync(path.join(spec.batch_inputs_dir, 'g3f1-batch-01-input.json'), 'utf8')
    );
    assert.equal(doc.infer_isolation, 'e3_no_legacy_ai_in_input');
    assert.equal(doc.tracks[0].review_only_suggestions, null);
  });

  test('run fail-closed；adopt disabled', async function () {
    const r = await run_g3_f1({ write: true });
    assert.equal(r.summary.adopt_disabled, true);
    const overlay = JSON.parse(fs.readFileSync(FILE_G3_D4_ADOPT_OVERLAY, 'utf8'));
    assert.notEqual(overlay.enabled, true);
    if (r.summary.staged_count < 100) {
      assert.equal(r.summary.halted, true);
    }
  });

  test('產物目錄', function () {
    assert.ok(fs.existsSync(G3_F1_WAVE_DIR));
    assert.ok(fs.existsSync(path.join(G3_F1_WAVE_DIR, 'full-library-reconcile.json')));
  });
});
