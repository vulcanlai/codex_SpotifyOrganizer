/**
 * G3-F.2
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'node:path';
import {
  dry_run_g3_f2_reconcile,
  prepare_g3_f2,
  run_g3_f2,
} from '../lib/classification/g3_f/run_g3_f2.js';
import { select_g3_f_wave } from '../lib/classification/g3_f/g3_f1_wave_select.js';
import { build_g3_f1_pending_queue } from '../lib/classification/g3_f/g3_f1_queue.js';
import { build_g3_f1_context } from '../lib/classification/g3_f/g3_f1_context.js';
import { g3_f2_wave_spec } from '../lib/classification/g3_f/g3_f2_wave_spec.js';
import {
  G3_F2_WAVE_DIR,
  G3_F2_WAVE_SEED,
  G3_F2_BATCH_ID_PREFIX,
  FILE_G3_F2_WAVE_100,
} from '../lib/classification/g3_f/paths_f2.js';
import { FILE_G3_F3_WAVE_100 } from '../lib/classification/g3_f/paths_f3.js';
import { FILE_G3_F4_WAVE_100 } from '../lib/classification/g3_f/paths_f4.js';
import { FILE_G3_F5_WAVE_100 } from '../lib/classification/g3_f/paths_f5.js';
import { FILE_G3_F6_WAVE_100 } from '../lib/classification/g3_f/paths_f6.js';
import { FILE_G3_F1_WAVE_100 } from '../lib/classification/g3_f/paths_f1.js';

const FILE_G3_F7_WAVE_100 = path.join(
  'backup',
  'classification',
  'g3-f7-wave-100',
  'wave-sample-100.json'
);

/** @param {string} file @returns {string|null} */
function wave_sample_bak_path(file) {
  return fs.existsSync(file) ? file + '.test.bak' : null;
}

/** @param {string} file @param {string|null} bak */
function hide_wave_sample(file, bak) {
  if (bak && fs.existsSync(file)) {
    if (fs.existsSync(bak)) {
      fs.renameSync(bak, file);
    }
    fs.renameSync(file, bak);
  }
}

/** @param {string} file @param {string|null} bak */
function restore_wave_sample(file, bak) {
  if (bak && !fs.existsSync(file) && fs.existsSync(bak)) {
    fs.renameSync(bak, file);
  }
}
import { FILE_G3_D4_ADOPT_OVERLAY } from '../lib/classification/g3_d/paths_d4.js';
import { assert_g3_f_dry_reconcile_pending } from './helpers/g3_f_pending_assert.js';

describe('G3-F.2', { concurrency: 1 }, function () {
  test('dry reconcile 排除 prior F waves', function () {
    const r = dry_run_g3_f2_reconcile();
    assert.equal(r.reconciliation.universe.library_index_ids, 7759);
    assert.ok(r.queue.excluded_prior_f_wave_track_count >= 200);
    assert_g3_f_dry_reconcile_pending(r, 200);
  });

  test('wave 100 固定 seed 且不含 F.1 ID', function () {
    const saved = JSON.parse(fs.readFileSync(FILE_G3_F2_WAVE_100, 'utf8'));
    assert.equal(saved.seed, G3_F2_WAVE_SEED);
    assert.equal(saved.track_count, 100);
    const cfg = {
      seed: G3_F2_WAVE_SEED,
      wave_id: 'g3-f2-wave-100',
      wave_size: 100,
      batch_size: 10,
      batch_id_prefix: G3_F2_BATCH_ID_PREFIX,
      cohort: 'g3_f2_pending_queue',
    };
    const wave_bak = FILE_G3_F2_WAVE_100 + '.test.bak';
    const f3_bak = fs.existsSync(FILE_G3_F3_WAVE_100) ? FILE_G3_F3_WAVE_100 + '.test.bak' : null;
    const f4_bak = wave_sample_bak_path(FILE_G3_F4_WAVE_100);
    const f5_bak = wave_sample_bak_path(FILE_G3_F5_WAVE_100);
    const f6_bak = wave_sample_bak_path(FILE_G3_F6_WAVE_100);
    const f7_bak = wave_sample_bak_path(FILE_G3_F7_WAVE_100);
    hide_wave_sample(FILE_G3_F2_WAVE_100, wave_bak);
    hide_wave_sample(FILE_G3_F3_WAVE_100, f3_bak);
    hide_wave_sample(FILE_G3_F4_WAVE_100, f4_bak);
    hide_wave_sample(FILE_G3_F5_WAVE_100, f5_bak);
    hide_wave_sample(FILE_G3_F6_WAVE_100, f6_bak);
    hide_wave_sample(FILE_G3_F7_WAVE_100, f7_bak);
    try {
      const q = build_g3_f1_pending_queue(build_g3_f1_context(), { exclude_prior_f_waves: true });
      assert.ok(q.pending_count === 1387 || q.pending_count === 1287);
      const a = select_g3_f_wave(q, cfg);
      const b = select_g3_f_wave(q, cfg);
      const saved_ids = JSON.parse(fs.readFileSync(wave_bak, 'utf8')).tracks.map(function (t) {
        return t.track_id;
      });
      const pick_ids = a.tracks.map(function (t) {
        return t.track_id;
      });
      assert.deepEqual(pick_ids, b.tracks.map(function (t) {
        return t.track_id;
      }));
      assert.deepEqual(pick_ids, saved_ids);
    } finally {
      restore_wave_sample(FILE_G3_F2_WAVE_100, wave_bak);
      restore_wave_sample(FILE_G3_F3_WAVE_100, f3_bak);
      restore_wave_sample(FILE_G3_F4_WAVE_100, f4_bak);
      restore_wave_sample(FILE_G3_F5_WAVE_100, f5_bak);
      restore_wave_sample(FILE_G3_F6_WAVE_100, f6_bak);
      restore_wave_sample(FILE_G3_F7_WAVE_100, f7_bak);
    }
    const f1 = JSON.parse(fs.readFileSync(FILE_G3_F1_WAVE_100, 'utf8'));
    const f1_ids = {};
    for (let i = 0; i < f1.tracks.length; i += 1) {
      f1_ids[f1.tracks[i].track_id] = true;
    }
    for (let j = 0; j < saved.tracks.length; j += 1) {
      assert.ok(!f1_ids[saved.tracks[j].track_id], '不得與 F.1 重複');
    }
  });

  test('prepare write:true 已 staged 完成時 skip 且不改 wave', function () {
    const wave_buf = fs.readFileSync(FILE_G3_F2_WAVE_100);
    const mtime_before = fs.statSync(FILE_G3_F2_WAVE_100).mtimeMs;
    const r = prepare_g3_f2({ write: true });
    assert.equal(r.skipped, true);
    assert.ok(r.reason_zh);
    assert.equal(fs.readFileSync(FILE_G3_F2_WAVE_100).equals(wave_buf), true);
    assert.equal(fs.statSync(FILE_G3_F2_WAVE_100).mtimeMs, mtime_before);
  });

  test('prepare 唯讀與 corrections log 結構', function () {
    prepare_g3_f2({ write: false, input_batch_limit: 1 });
    const spec = g3_f2_wave_spec();
    assert.ok(fs.existsSync(G3_F2_WAVE_DIR));
    assert.ok(fs.existsSync(path.join(spec.batch_inputs_dir, 'g3f2-batch-01-input.json')));
    const corr = JSON.parse(fs.readFileSync(spec.file_validation_corrections, 'utf8'));
    assert.equal(corr.schema_version, 1);
    assert.ok(Array.isArray(corr.corrections));
    assert.ok(Array.isArray(corr.agent_revisions));
  });

  test('run fail-closed；adopt disabled', async function () {
    const r = await run_g3_f2({ write: true });
    assert.equal(r.summary.adopt_disabled, true);
    const overlay = JSON.parse(fs.readFileSync(FILE_G3_D4_ADOPT_OVERLAY, 'utf8'));
    assert.notEqual(overlay.enabled, true);
    if (r.summary.staged_count < 100) {
      assert.equal(r.summary.halted, true);
    }
  });
});
