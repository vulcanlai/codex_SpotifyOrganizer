/**
 * G3-F 可變 wave_size（含最後一波 87 首）— 純邏輯／路徑，不 prepare 正式目錄
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp_g3_f_wave_size,
  resolve_next_g3_f_wave,
} from '../lib/classification/g3_f/g3_f_wave_manifest.js';
import { plan_g3_f_batch_layout } from '../lib/classification/g3_f/run_g3_f_next.js';
import { build_g3_f_paths } from '../lib/classification/g3_f/g3_f_paths_dynamic.js';
import { select_g3_f_wave } from '../lib/classification/g3_f/g3_f1_wave_select.js';
import { G3_F1_BATCH_SIZE } from '../lib/classification/g3_f/paths_f1.js';

describe('G3-F wave_size 87', { concurrency: 1 }, function () {
  test('clamp：pending 87 時 count=100 → 87', function () {
    assert.equal(clamp_g3_f_wave_size(100, 87), 87);
    assert.equal(clamp_g3_f_wave_size(87, 87), 87);
  });

  test('batch layout：87 首 → 9 批，最後 7 首', function () {
    const plan = plan_g3_f_batch_layout(87, 10);
    assert.equal(plan.batch_count, 9);
    assert.deepEqual(plan.batch_sizes, [10, 10, 10, 10, 10, 10, 10, 10, 7]);
  });

  test('路徑命名 g3-f15-wave-87', function () {
    const p = build_g3_f_paths(15, 87);
    assert.equal(p.wave_id, 'g3-f15-wave-87');
    assert.equal(p.wave_seed, 'g3-f15:wave-87:v1');
    assert.equal(p.file_wave.endsWith('wave-sample-87.json'), true);
  });

  test('select_g3_f_wave 產生 9 批／87 首', function () {
    /** @type {object[]} */
    const pending_tracks = [];
    for (let i = 0; i < 87; i += 1) {
      pending_tracks.push({
        track_id: 'tid_' + String(i).padStart(3, '0'),
        queue_reason_zh: 'test',
        diversity_rule_primary_hint: 'pop',
        title_script: 'latin',
        index_language: '國語',
      });
    }
    const queue = { pending_count: 87, pending_tracks: pending_tracks };
    const wave = select_g3_f_wave(queue, {
      seed: 'test:wave-87:v1',
      wave_id: 'g3-f15-wave-87',
      wave_size: 87,
      batch_size: G3_F1_BATCH_SIZE,
      batch_id_prefix: 'g3f15-batch-',
      cohort: 'test',
    });
    assert.equal(wave.track_count, 87);
    assert.equal(wave.batch_count, 9);
    assert.equal(wave.batches[8].track_ids.length, 7);
    assert.equal(wave.batches[0].track_ids.length, 10);
  });

  test('resolve new_wave：pending 87、count 100 → wave_size 87', function () {
    const next = resolve_next_g3_f_wave({
      requested_wave_size: 100,
      pending_count: 87,
      force_wave_number: 15,
    });
    assert.equal(next.wave_number, 15);
    assert.equal(next.wave_size, 87);
    assert.equal(next.paths.wave_id, 'g3-f15-wave-87');
  });

  test('wave-100 路徑仍相容 F.1～F.14', function () {
    const p = build_g3_f_paths(14, 100);
    assert.equal(p.wave_id, 'g3-f14-wave-100');
  });
});
