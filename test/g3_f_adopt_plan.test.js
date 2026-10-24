/**
 * G3-F apply-plan 安全機制（隔離路徑，不寫正式 registry）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  build_g3_f_adopt_plan,
  verify_plan_hash,
  validate_plan_for_apply,
  compute_plan_hash,
  load_g3_f_adopt_plan_file,
} from '../lib/classification/g3_f/g3_f_adopt_plan.js';
import {
  empty_g3_f_adopt_registry,
  merge_g3_f_adopt_batch_idempotent,
  save_g3_f_adopt_registry,
  load_g3_f_adopt_registry,
} from '../lib/classification/g3_f/g3_f_adopt_registry_store.js';
import { select_g3_f_adopt_batch } from '../lib/classification/g3_f/g3_f_eligible.js';
import {
  run_g3_f_adopt_dry_run,
  run_g3_f_adopt_apply_from_plan,
  simulate_g3_f_adopt_apply_from_plan,
  parse_g3_f_adopt_cli_args,
  format_dry_run_cli_summary,
  G3_F_ADOPT_AUTHORIZE_TOKEN,
} from '../lib/classification/g3_f/g3_f_adopt_run.js';
import { FILE_G3_F_ADOPT_REGISTRY } from '../lib/classification/paths.js';

function tmp_reg_path() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3f-plan-reg-'));
  return path.join(dir, 'g3-f-adopt-registry.json');
}

function adopted_count(reg_path) {
  const doc = load_g3_f_adopt_registry({ file_path: reg_path });
  return Object.keys(doc.adoptions_by_track_id || {}).filter(function (id) {
    return doc.adoptions_by_track_id[id].status === 'adopted';
  }).length;
}

test('1. dry-run 產生有效 apply-plan', function () {
  const out = path.join(os.tmpdir(), 'g3f-plan-dry-' + Date.now());
  const report = run_g3_f_adopt_dry_run({
    output_dir: out,
    batch_size: 3,
    batch_index: 0,
    write_reports: true,
  });
  const plan_path = path.join(out, 'apply-plan.json');
  assert.ok(fs.existsSync(plan_path));
  const plan = load_g3_f_adopt_plan_file(plan_path);
  assert.equal(plan.tracks.length, report.batch_track_count);
  assert.ok(verify_plan_hash(plan).ok);
  assert.equal(plan.plan_hash, report.plan_hash);
  const summary = format_dry_run_cli_summary(report, false);
  assert.equal(summary.mode, 'dry_run');
  assert.ok(!summary.batch_track_ids);
});

test('2. 有效 plan 模擬 apply（ready）', function () {
  const reg_path = tmp_reg_path();
  save_g3_f_adopt_registry(empty_g3_f_adopt_registry(), { file_path: reg_path });
  const sel = select_g3_f_adopt_batch({
    batch_size: 2,
    batch_index: 0,
    registry_file_path: reg_path,
  });
  const plan = build_g3_f_adopt_plan({
    batch: sel.batch,
    registry_doc: load_g3_f_adopt_registry({ file_path: reg_path }),
    batch_size: 2,
    batch_index: 0,
    batch_id: 'test-plan-sim',
  });
  const sim = simulate_g3_f_adopt_apply_from_plan({
    plan: plan,
    registry_file_path: reg_path,
  });
  assert.equal(sim.result, 'ready');
  assert.equal(sim.insert_count, 2);
});

test('3. 相同 plan 重複 apply → already_applied', function () {
  const reg_path = tmp_reg_path();
  save_g3_f_adopt_registry(empty_g3_f_adopt_registry(), { file_path: reg_path });
  const sel = select_g3_f_adopt_batch({
    batch_size: 2,
    batch_index: 0,
    registry_file_path: reg_path,
  });
  const plan = build_g3_f_adopt_plan({
    batch: sel.batch,
    registry_doc: load_g3_f_adopt_registry({ file_path: reg_path }),
    batch_size: 2,
    batch_index: 0,
    batch_id: 'test-plan-dup',
  });
  run_g3_f_adopt_apply_from_plan({
    authorize_token: G3_F_ADOPT_AUTHORIZE_TOKEN,
    allow_production_write: true,
    plan: plan,
    registry_file_path: reg_path,
    skip_index_rebuild: true,
    skip_backup: true,
  });
  assert.equal(adopted_count(reg_path), 2);
  const second = run_g3_f_adopt_apply_from_plan({
    authorize_token: G3_F_ADOPT_AUTHORIZE_TOKEN,
    allow_production_write: true,
    plan: plan,
    registry_file_path: reg_path,
    skip_index_rebuild: true,
    skip_backup: true,
  });
  assert.equal(second.result, 'already_applied');
  assert.equal(second.insert_count, 0);
  assert.equal(adopted_count(reg_path), 2);
});

test('4. 舊式 apply 無 apply-plan 被拒絕', function () {
  const reg_path = tmp_reg_path();
  const before = adopted_count(FILE_G3_F_ADOPT_REGISTRY);
  assert.throws(function () {
    run_g3_f_adopt_apply_from_plan({
      authorize_token: G3_F_ADOPT_AUTHORIZE_TOKEN,
      allow_production_write: true,
      batch_size: 10,
      registry_file_path: reg_path,
    });
  }, /apply-plan/);
  assert.equal(adopted_count(FILE_G3_F_ADOPT_REGISTRY), before);
});

test('5. plan 內容遭修改 → plan_hash 失效', function () {
  const reg_path = tmp_reg_path();
  save_g3_f_adopt_registry(empty_g3_f_adopt_registry(), { file_path: reg_path });
  const sel = select_g3_f_adopt_batch({ batch_size: 1, batch_index: 0, registry_file_path: reg_path });
  const plan = build_g3_f_adopt_plan({
    batch: sel.batch,
    registry_doc: load_g3_f_adopt_registry({ file_path: reg_path }),
    batch_size: 1,
    batch_index: 0,
  });
  plan.tracks[0].title = 'TAMPERED';
  assert.equal(verify_plan_hash(plan).ok, false);
  const v = validate_plan_for_apply({ plan: plan, registry_doc: load_g3_f_adopt_registry({ file_path: reg_path }) });
  assert.equal(v.ok, false);
});

test('6. registry 基準改變 → 拒絕', function () {
  const reg_path = tmp_reg_path();
  save_g3_f_adopt_registry(empty_g3_f_adopt_registry(), { file_path: reg_path });
  const sel = select_g3_f_adopt_batch({ batch_size: 2, batch_index: 0, registry_file_path: reg_path });
  const plan = build_g3_f_adopt_plan({
    batch: sel.batch,
    registry_doc: load_g3_f_adopt_registry({ file_path: reg_path }),
    batch_size: 2,
    batch_index: 0,
  });
  const selOther = select_g3_f_adopt_batch({ batch_size: 1, batch_index: 5, registry_file_path: reg_path });
  const merged = merge_g3_f_adopt_batch_idempotent(
    load_g3_f_adopt_registry({ file_path: reg_path }),
    selOther.batch
  );
  save_g3_f_adopt_registry(merged.registry_doc, { file_path: reg_path });
  assert.notEqual(selOther.batch[0].track_id, sel.batch[0].track_id);
  assert.notEqual(selOther.batch[0].track_id, sel.batch[1].track_id);
  const v = validate_plan_for_apply({
    plan: plan,
    registry_doc: load_g3_f_adopt_registry({ file_path: reg_path }),
  });
  assert.equal(v.ok, false);
  assert.equal(v.phase, 'registry_baseline');
});

test('7. manual-overrides 衝突 → 拒絕', function () {
  const reg_path = tmp_reg_path();
  save_g3_f_adopt_registry(empty_g3_f_adopt_registry(), { file_path: reg_path });
  const sel = select_g3_f_adopt_batch({ batch_size: 1, batch_index: 0, registry_file_path: reg_path });
  const plan = build_g3_f_adopt_plan({
    batch: sel.batch,
    registry_doc: load_g3_f_adopt_registry({ file_path: reg_path }),
    batch_size: 1,
    batch_index: 0,
  });
  const id = plan.tracks[0].track_id;
  const v = validate_plan_for_apply({
    plan: plan,
    registry_doc: load_g3_f_adopt_registry({ file_path: reg_path }),
    overrides_doc: {
      schema_version: 1,
      overrides_by_track_id: {
        [id]: { source: 'test', genre_profile: { primary_genre: 'pop', subgenres: [], secondary_genres: [] } },
      },
    },
  });
  assert.equal(v.ok, false);
  assert.equal(v.phase, 'eligibility');
});

test('8. 部分採用 → 拒絕', function () {
  const reg_path = tmp_reg_path();
  save_g3_f_adopt_registry(empty_g3_f_adopt_registry(), { file_path: reg_path });
  const sel = select_g3_f_adopt_batch({ batch_size: 3, batch_index: 0, registry_file_path: reg_path });
  const plan = build_g3_f_adopt_plan({
    batch: sel.batch,
    registry_doc: load_g3_f_adopt_registry({ file_path: reg_path }),
    batch_size: 3,
    batch_index: 0,
  });
  const partial = merge_g3_f_adopt_batch_idempotent(
    load_g3_f_adopt_registry({ file_path: reg_path }),
    [sel.batch[0]]
  );
  save_g3_f_adopt_registry(partial.registry_doc, { file_path: reg_path });
  const v = validate_plan_for_apply({
    plan: plan,
    registry_doc: load_g3_f_adopt_registry({ file_path: reg_path }),
  });
  assert.equal(v.ok, false);
  assert.equal(v.result, 'partial_applied');
});

test('9. 驗證失敗不寫入 registry', function () {
  const reg_path = tmp_reg_path();
  save_g3_f_adopt_registry(empty_g3_f_adopt_registry(), { file_path: reg_path });
  const sel = select_g3_f_adopt_batch({ batch_size: 1, batch_index: 0, registry_file_path: reg_path });
  const plan = build_g3_f_adopt_plan({
    batch: sel.batch,
    registry_doc: load_g3_f_adopt_registry({ file_path: reg_path }),
    batch_size: 1,
    batch_index: 0,
  });
  plan.plan_hash = 'deadbeef';
  assert.throws(function () {
    run_g3_f_adopt_apply_from_plan({
      authorize_token: G3_F_ADOPT_AUTHORIZE_TOKEN,
      allow_production_write: true,
      plan: plan,
      registry_file_path: reg_path,
      skip_index_rebuild: true,
    });
  });
  assert.equal(adopted_count(reg_path), 0);
});

test('10. CLI parse：authorize 無 plan、--verbose', function () {
  const a = parse_g3_f_adopt_cli_args([
    '--authorize-apply=' + G3_F_ADOPT_AUTHORIZE_TOKEN,
    '--batch-size=300',
  ]);
  assert.equal(a.dry_run, false);
  assert.equal(a.apply_plan_path, undefined);
  const b = parse_g3_f_adopt_cli_args(['--apply-plan=reports/x/apply-plan.json', '--verbose']);
  assert.equal(b.apply_plan_path, 'reports/x/apply-plan.json');
  assert.equal(b.verbose, true);
});
