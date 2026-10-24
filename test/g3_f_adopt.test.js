/**
 * G3-F registry 採用（隔離路徑，不寫正式 classification）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build_classification_index } from '../lib/classification/build_index.js';
import { build_formal_classification_state } from '../lib/classification/formal_state_build.js';
import { empty_g3_f_adopt_registry, merge_g3_f_adopt_batch_idempotent, save_g3_f_adopt_registry } from '../lib/classification/g3_f/g3_f_adopt_registry_store.js';
import { select_g3_f_adopt_batch } from '../lib/classification/g3_f/g3_f_eligible.js';
import { run_g3_f_adopt_dry_run } from '../lib/classification/g3_f/g3_f_adopt_run.js';
import {
  create_g3_f_adopt_backup,
  restore_g3_f_adopt_backup,
} from '../lib/classification/g3_f/g3_f_adopt_backup.js';
import { apply_manual_overrides_to_tags } from '../lib/classification/apply_overrides.js';
import { apply_g3_f_adopt_registry_to_tags } from '../lib/classification/g3_f/apply_g3_f_adopt_registry.js';
import { build_track_genre_profile } from '../lib/classification/genre_profile.js';
import { FILE_G3_F_ADOPT_REGISTRY } from '../lib/classification/paths.js';

test('無 registry 檔時 build 與明確空 registry 一致（抽樣 track）', function () {
  const a = build_classification_index({ write: false });
  const b = build_classification_index({
    write: false,
    g3_f_registry_doc: empty_g3_f_adopt_registry(),
  });
  const sample_id = Object.keys(a.index_doc.tracks_by_id).sort()[0];
  assert.deepEqual(
    a.index_doc.tracks_by_id[sample_id].genre_profile,
    b.index_doc.tracks_by_id[sample_id].genre_profile
  );
});

test('registry 採用 → genre confidence inferred、formal ai_suggested', function () {
  const selection = select_g3_f_adopt_batch({ batch_size: 1, batch_index: 0 });
  assert.ok(selection.batch.length >= 1);
  const c = selection.batch[0];
  const reg = empty_g3_f_adopt_registry();
  const merged = merge_g3_f_adopt_batch_idempotent(reg, [c]).registry_doc;
  const id = c.track_id;

  const before = build_classification_index({
    write: false,
    g3_f_registry_doc: empty_g3_f_adopt_registry(),
  });
  const after = build_classification_index({
    write: false,
    g3_f_registry_doc: merged,
  });

  const gp = after.index_doc.tracks_by_id[id].genre_profile;
  assert.equal(gp.confidence, 'inferred');
  assert.equal(gp.source, 'g3-f-adopt-registry.json');

  const formal = build_formal_classification_state(after.index_doc, {
    write: false,
    g3_f_registry_doc: merged,
  });
  assert.equal(formal.states_by_track_id[id].formal_state, 'ai_suggested');

  const unchanged = before.index_doc.tracks_by_id[id].genre_profile;
  assert.notEqual(unchanged.primary_genre, gp.primary_genre);
});

test('manual-overrides 優先於 registry genre_profile', function () {
  const selection = select_g3_f_adopt_batch({ batch_size: 1, batch_index: 0 });
  const c = selection.batch[0];
  const merged = merge_g3_f_adopt_batch_idempotent(empty_g3_f_adopt_registry(), [c])
    .registry_doc;
  const id = c.track_id;
  const overrides_doc = {
    schema_version: 1,
    overrides_by_track_id: {
      [id]: {
        source: 'manual-test',
        genre_profile: {
          primary_genre: 'classical',
          subgenres: [],
          secondary_genres: [],
        },
      },
    },
  };
  const built = build_classification_index({
    write: false,
    overrides_doc,
    g3_f_registry_doc: merged,
  });
  assert.equal(built.index_doc.tracks_by_id[id].genre_profile.primary_genre, 'classical');
  assert.equal(built.index_doc.tracks_by_id[id].genre_profile.confidence, 'confirmed');
});

test('registry merge 冪等', function () {
  const selection = select_g3_f_adopt_batch({ batch_size: 2, batch_index: 0 });
  let reg = empty_g3_f_adopt_registry();
  const m1 = merge_g3_f_adopt_batch_idempotent(reg, selection.batch);
  const m2 = merge_g3_f_adopt_batch_idempotent(m1.registry_doc, selection.batch);
  assert.equal(m1.applied.length, 2);
  assert.equal(m2.applied.length, 0);
  assert.equal(m2.skipped.length, 2);
});

test('備份還原（暫存 classification 目錄）', function () {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g3f-backup-'));
  const class_dir = path.join(tmp, 'classification');
  fs.mkdirSync(class_dir, { recursive: true });
  const reg_path = path.join(class_dir, 'g3-f-adopt-registry.json');
  fs.writeFileSync(
    reg_path,
    JSON.stringify({ schema_version: 1, adoptions_by_track_id: { x: { status: 'adopted' } } }),
    'utf8'
  );
  const backup = create_g3_f_adopt_backup({
    backup_root: path.join(tmp, 'snapshots'),
    backup_id: 'test-1',
    classification_dir: class_dir,
  });
  fs.writeFileSync(reg_path, JSON.stringify({ schema_version: 1, adoptions_by_track_id: {} }), 'utf8');
  restore_g3_f_adopt_backup(backup.backup_dir, { classification_dir: class_dir });
  const restored = JSON.parse(fs.readFileSync(reg_path, 'utf8'));
  assert.ok(restored.adoptions_by_track_id.x);
});

test('select 預設排除 registry 已 adopted，下一批接續 eligible 排序', function () {
  const reg_path = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'g3f-sel-')), 'reg.json');
  fs.writeFileSync(
    reg_path,
    JSON.stringify({ schema_version: 1, adoptions_by_track_id: {} }),
    'utf8'
  );
  const full = select_g3_f_adopt_batch({
    batch_size: 100,
    batch_index: 0,
    skip_registry_adopted: false,
    registry_file_path: reg_path,
  });
  const first10 = full.batch.slice(0, 10);
  let reg = empty_g3_f_adopt_registry();
  const merged = merge_g3_f_adopt_batch_idempotent(reg, first10);
  save_g3_f_adopt_registry(merged.registry_doc, { file_path: reg_path });
  const pending = select_g3_f_adopt_batch({
    batch_size: 100,
    batch_index: 0,
    skip_registry_adopted: true,
    registry_file_path: reg_path,
  });
  assert.equal(full.eligible.length, pending.eligible.length);
  assert.equal(pending.exclusion_counts.registry_already_adopted, 10);
  const batch0_ids = full.batch.slice(0, 10).map(function (t) {
    return t.track_id;
  });
  const pending_ids = pending.batch.map(function (t) {
    return t.track_id;
  });
  const expected = full.eligible.slice(10, 110).map(function (t) {
    return t.track_id;
  });
  assert.deepEqual(pending_ids, expected);
  for (let i = 0; i < batch0_ids.length; i += 1) {
    assert.ok(pending_ids.indexOf(batch0_ids[i]) < 0);
  }
});

test('dry-run 報告（不寫 registry 正式檔）', function () {
  const before_exists = fs.existsSync(FILE_G3_F_ADOPT_REGISTRY);
  const out = path.join(os.tmpdir(), 'g3f-dry-' + Date.now());
  const r1 = run_g3_f_adopt_dry_run({
    write_reports: true,
    output_dir: out,
    batch_size: 10,
    batch_index: 0,
  });
  const r2 = run_g3_f_adopt_dry_run({
    write_reports: true,
    output_dir: out,
    batch_size: 10,
    batch_index: 0,
  });
  assert.equal(r1.eligible_total, r2.eligible_total);
  assert.deepEqual(r1.batch_track_ids, r2.batch_track_ids);
  for (let i = 0; i < r1.tracks.length; i += 1) {
    assert.equal(r1.tracks[i].formal_state.after, 'ai_suggested');
    assert.equal(r1.tracks[i].classification_diff.after.genre_profile_confidence, 'inferred');
  }
  assert.equal(fs.existsSync(FILE_G3_F_ADOPT_REGISTRY), before_exists);
});
