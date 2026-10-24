/**
 * G3-F 通用 g3:f-next 工具
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  resolve_next_g3_f_wave,
  list_g3_f_wave_numbers_on_disk,
  read_g3_f_wave_status,
} from '../lib/classification/g3_f/g3_f_wave_manifest.js';
import { parse_g3_f_next_args } from '../lib/classification/g3_f/run_g3_f_next.js';
import { dry_run_g3_f_dynamic_reconcile } from '../lib/classification/g3_f/run_g3_f_dynamic.js';
import { build_g3_f_paths } from '../lib/classification/g3_f/g3_f_paths_dynamic.js';
import { FILE_G3_F6_WAVE_100 } from '../lib/classification/g3_f/paths_f6.js';

describe('G3-F next 工具', { concurrency: 1 }, function () {
  test('parse args 預設 dry-run', function () {
    const cli = parse_g3_f_next_args([]);
    assert.equal(cli.dry_run, true);
    assert.equal(cli.count, 100);
  });

  test('resolve 下一波編號大於已 staged 最高波次', function () {
    assert.ok(fs.existsSync(FILE_G3_F6_WAVE_100));
    const nums = [];
    for (let n = 1; n <= 20; n += 1) {
      const st = read_g3_f_wave_status(n, 100);
      if (st.staged_complete) {
        nums.push(n);
      }
    }
    const max_staged = nums.length ? Math.max.apply(null, nums) : 0;
    const next = resolve_next_g3_f_wave({ requested_wave_size: 100, pending_count: 87 });
    assert.ok(next.wave_number >= max_staged + 1 || next.mode === 'resume_incomplete');
  });

  test('dry reconcile 全庫 7759、pending 為非負', function () {
    const r = dry_run_g3_f_dynamic_reconcile();
    assert.equal(r.reconciliation.universe.library_index_ids, 7759);
    assert.ok(r.queue.pending_count >= 0);
    assert.ok(r.queue.excluded_prior_f_wave_track_count >= 700);
  });

  test('磁碟已註冊 F.1～F.7', function () {
    const nums = list_g3_f_wave_numbers_on_disk();
    for (let n = 1; n <= 7; n += 1) {
      assert.ok(nums.indexOf(n) >= 0, '缺少 F.' + n);
    }
  });

  test('F.7 路徑命名', function () {
    const p = build_g3_f_paths(7, 100);
    assert.equal(p.wave_id, 'g3-f7-wave-100');
    assert.equal(p.wave_seed, 'g3-f7:wave-100:v1');
    assert.equal(p.batch_id_prefix, 'g3f7-batch-');
  });
});
