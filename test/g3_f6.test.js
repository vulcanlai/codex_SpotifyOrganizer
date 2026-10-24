/**
 * G3-F.6
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  dry_run_g3_f6_reconcile,
  prepare_g3_f6,
  run_g3_f6,
} from '../lib/classification/g3_f/run_g3_f6.js';
import { g3_f6_wave_spec } from '../lib/classification/g3_f/g3_f6_wave_spec.js';
import {
  G3_F6_WAVE_DIR,
  G3_F6_WAVE_SEED,
  FILE_G3_F6_WAVE_100,
} from '../lib/classification/g3_f/paths_f6.js';
import { FILE_G3_F5_WAVE_100 } from '../lib/classification/g3_f/paths_f5.js';
import { FILE_G3_F4_WAVE_100 } from '../lib/classification/g3_f/paths_f4.js';
import { FILE_G3_F1_WAVE_100 } from '../lib/classification/g3_f/paths_f1.js';
import { FILE_G3_F2_WAVE_100 } from '../lib/classification/g3_f/paths_f2.js';
import { FILE_G3_F3_WAVE_100 } from '../lib/classification/g3_f/paths_f3.js';
import { FILE_G3_D4_ADOPT_OVERLAY } from '../lib/classification/g3_d/paths_d4.js';
import { assert_g3_f_dry_reconcile_pending } from './helpers/g3_f_pending_assert.js';

describe('G3-F.6', { concurrency: 1 }, function () {
  test('dry reconcile 排除 prior F waves', function () {
    const r = dry_run_g3_f6_reconcile();
    assert.equal(r.reconciliation.universe.library_index_ids, 7759);
    assert.ok(r.queue.excluded_prior_f_wave_track_count >= 500);
    assert_g3_f_dry_reconcile_pending(r, 500);
  });

  test('wave 固定 seed 且不含 F.1～F.5 ID', function () {
    if (!fs.existsSync(FILE_G3_F6_WAVE_100)) {
      return;
    }
    const saved = JSON.parse(fs.readFileSync(FILE_G3_F6_WAVE_100, 'utf8'));
    assert.equal(saved.seed, G3_F6_WAVE_SEED);
    const prior = {};
    const files = [
      FILE_G3_F1_WAVE_100,
      FILE_G3_F2_WAVE_100,
      FILE_G3_F3_WAVE_100,
      FILE_G3_F4_WAVE_100,
      FILE_G3_F5_WAVE_100,
    ];
    for (let f = 0; f < files.length; f += 1) {
      const doc = JSON.parse(fs.readFileSync(files[f], 'utf8'));
      for (let i = 0; i < doc.tracks.length; i += 1) {
        prior[doc.tracks[i].track_id] = true;
      }
    }
    for (let k = 0; k < saved.tracks.length; k += 1) {
      assert.ok(!prior[saved.tracks[k].track_id], '不得與 F.1～F.5 重複');
    }
  });

  test('prepare 唯讀或目錄存在', function () {
    prepare_g3_f6({ write: false, input_batch_limit: 1 });
    if (fs.existsSync(G3_F6_WAVE_DIR)) {
      const spec = g3_f6_wave_spec();
      assert.ok(fs.existsSync(path.join(spec.batch_inputs_dir, 'g3f6-batch-01-input.json')));
    }
  });

  test('run fail-closed；adopt disabled', async function () {
    if (!fs.existsSync(FILE_G3_F6_WAVE_100)) {
      return;
    }
    const r = await run_g3_f6({ write: true });
    assert.equal(r.summary.adopt_disabled, true);
    const overlay = JSON.parse(fs.readFileSync(FILE_G3_D4_ADOPT_OVERLAY, 'utf8'));
    assert.notEqual(overlay.enabled, true);
    if (r.summary.staged_count < 100) {
      assert.equal(r.summary.halted, true);
    }
  });
});
