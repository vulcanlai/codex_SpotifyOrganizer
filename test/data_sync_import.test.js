/**
 * 資料同步匯入測試（暫存假專案）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run_data_export } from '../lib/data_sync/export_run.js';
import { run_data_import } from '../lib/data_sync/import_run.js';
import { run_import_gui_flow } from '../lib/data_sync/import_gui_flow.js';
import {
  normalize_and_validate_import_member_path,
  detect_case_insensitive_path_collisions,
} from '../lib/data_sync/import_path_rules.js';
import { evaluate_import_handoff } from '../lib/data_sync/import_conflict.js';
import { compute_bundle_id_from_manifest } from '../lib/data_sync/bundle_id.js';
import {
  load_manifest_from_extract,
  run_full_import_extract_verification,
} from '../lib/data_sync/import_verify.js';
import {
  write_pre_import_backup,
  restore_from_pre_import_backup,
} from '../lib/data_sync/import_backup.js';
import { validate_zip_input_path } from '../lib/data_sync/path_guard.js';
import {
  FORBIDDEN_ABSOLUTE_ROOTS,
  ENV_DATA_SYNC_ZIP_PASSWORD,
} from '../lib/data_sync/constants.js';
import {
  create_unique_acceptance_sandbox,
  remove_acceptance_sandbox_safely,
} from '../lib/data_sync/acceptance_sandbox.js';
import { resolve_project_root_from_anchor } from '../lib/data_sync/project_root.js';
import { hash_file_sha256_sync } from '../lib/data_sync/file_hash.js';

const TEST_PASSWORD = 'test-import-password-value';

const REQUIRED_CORE = [
  'backup/merged/library-v2.json',
  'backup/classification/manual-overrides.json',
  'backup/classification/classification-index.json',
  'backup/classification/classification-summary.json',
  'backup/classification/classification-settings.json',
  'backup/classification/formal-classification-state.json',
  'backup/classification/g3-f-adopt-registry.json',
];

function enable_test_env() {
  process.env.DATA_SYNC_ALLOW_PROJECT_ROOT_OVERRIDE = '1';
  process.env.DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN = '1';
}

function make_source_project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'so-import-src-'));
  const dirs = ['backup/merged', 'backup/classification', 'imports'];
  for (let i = 0; i < dirs.length; i += 1) {
    fs.mkdirSync(path.join(root, dirs[i]), { recursive: true });
  }
  for (let j = 0; j < REQUIRED_CORE.length; j += 1) {
    const p = path.join(root, REQUIRED_CORE[j].split('/').join(path.sep));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ id: REQUIRED_CORE[j], v: 1 }), 'utf8');
  }
  fs.writeFileSync(path.join(root, 'imports/a.txt'), 'track', 'utf8');
  return root;
}

function make_empty_target() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'so-import-tgt-'));
}

async function export_zip_from(root, zip_path) {
  return run_data_export({
    project_root_override: root,
    output_zip: zip_path,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
  });
}

async function import_zip_to(target, zip_path, opts) {
  return run_data_import(
    Object.assign(
      {
        project_root_override: target,
        input_zip: zip_path,
        password_mode: 'stdin',
        stdin_password: TEST_PASSWORD,
      },
      opts || {}
    )
  );
}

test('西元、舊民國年份及自訂 ZIP 檔名皆可正常匯入', async function () {
  enable_test_env();
  const src = make_source_project();
  const bundle_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-zip-name-'));
  const targets = [];
  try {
    const zip = path.join(bundle_dir, 'spotify-handoff-20261102-233213.zip');
    const names = ['spotify-handoff-20261102-233213.zip',
      'spotify-handoff-1151102-233213.zip', 'spotify-organizer-handoff.zip'];
    for (const name of names) targets.push(make_empty_target());
    // ZIP readers may retain file handles until process exit on Windows.
    // Run the round trips in a child so the parent can safely remove every owned fixture.
    const worker = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import path from 'node:path';
      import { run_data_export } from ${JSON.stringify(new URL('../lib/data_sync/export_run.js', import.meta.url).href)};
      import { run_data_import } from ${JSON.stringify(new URL('../lib/data_sync/import_run.js', import.meta.url).href)};
      const src = ${JSON.stringify(src)}, zip = ${JSON.stringify(zip)};
      const names = ${JSON.stringify(names)}, targets = ${JSON.stringify(targets)};
      const options = { password_mode: 'stdin', stdin_password: ${JSON.stringify(TEST_PASSWORD)} };
      assert.equal((await run_data_export({ ...options, project_root_override: src, output_zip: zip })).ok, true);
      for (let i = 0; i < names.length; i++) {
        const candidate = path.join(path.dirname(zip), names[i]);
        if (candidate !== zip) fs.copyFileSync(zip, candidate);
        const input = { ...options, project_root_override: targets[i], input_zip: candidate };
        const dry = await run_data_import({ ...input, dry_run: true });
        assert.equal(dry.ok, true, JSON.stringify(dry));
        const applied = await run_data_import({ ...input, apply: true, confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT' });
        assert.equal(applied.ok, true, JSON.stringify(applied));
      }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', worker], {
      encoding: 'utf8', timeout: 30000, env: { ...process.env },
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    for (const target of targets) {
      assert.equal(fs.readFileSync(path.join(target, REQUIRED_CORE[0]), 'utf8'),
        fs.readFileSync(path.join(src, REQUIRED_CORE[0]), 'utf8'));
    }
  } finally {
    for (const owned of [src, bundle_dir, ...targets]) {
      assert.equal(path.dirname(owned), path.resolve(os.tmpdir()));
      assert.match(path.basename(owned), /^so-(import-src-|import-tgt-|zip-name-)/);
      fs.rmSync(owned, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
});

test('1. 正常初次匯入', async function () {
  enable_test_env();
  const src = make_source_project();
  const tgt = make_empty_target();
  const zip = path.join(os.tmpdir(), 'so-imp-' + Date.now() + '.zip');
  const ex = await export_zip_from(src, zip);
  assert.equal(ex.ok, true);
  const dr = await import_zip_to(tgt, zip, { dry_run: true });
  assert.equal(dr.ok, true);
  assert.equal(dr.preview.handoff.scenario, 'first_import');
  const ap = await import_zip_to(tgt, zip, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
  });
  assert.equal(ap.ok, true);
  assert.ok(fs.existsSync(path.join(tgt, 'backup/merged/library-v2.json')));
});

test('2. 正常接續匯入', async function () {
  enable_test_env();
  const src = make_source_project();
  const tgt = make_empty_target();
  const zip1 = path.join(os.tmpdir(), 'so-imp-a-' + Date.now() + '.zip');
  await export_zip_from(src, zip1);
  await import_zip_to(tgt, zip1, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
  });
  fs.writeFileSync(
    path.join(src, 'backup/merged/library-v2.json'),
    JSON.stringify({ id: 'v2', v: 2 }),
    'utf8'
  );
  const zip2 = path.join(os.tmpdir(), 'so-imp-b-' + Date.now() + '.zip');
  await export_zip_from(src, zip2);
  const dr = await import_zip_to(tgt, zip2, { dry_run: true });
  assert.equal(dr.ok, true);
  assert.equal(dr.preview.handoff.scenario, 'continuation_ok');
});

test('3. 重複匯入同一 ZIP', async function () {
  enable_test_env();
  const src = make_source_project();
  const tgt = make_empty_target();
  const zip = path.join(os.tmpdir(), 'so-imp-dup-' + Date.now() + '.zip');
  await export_zip_from(src, zip);
  await import_zip_to(tgt, zip, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
  });
  const again = await import_zip_to(tgt, zip, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
  });
  assert.equal(again.ok, true);
  assert.equal(again.skipped_apply, true);
});

test('4. 匯入較舊 ZIP 拒絕', async function () {
  enable_test_env();
  const src = make_source_project();
  const tgt = make_empty_target();
  const zip_old = path.join(os.tmpdir(), 'so-imp-old-' + Date.now() + '.zip');
  const zip_new = path.join(os.tmpdir(), 'so-imp-new-' + Date.now() + '.zip');
  await export_zip_from(src, zip_old);
  await import_zip_to(tgt, zip_old, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
  });
  fs.writeFileSync(
    path.join(src, 'backup/merged/library-v2.json'),
    '{"v":9}',
    'utf8'
  );
  await export_zip_from(src, zip_new);
  await import_zip_to(tgt, zip_new, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
  });
  const old_try = await import_zip_to(tgt, zip_old, { dry_run: true });
  assert.equal(old_try.ok, false);
  assert.ok(
    ['handoff_chain_break', 'state_inconsistent'].includes(
      old_try.preview.handoff.scenario
    )
  );
});

test('5. 本機資料修改後衝突', async function () {
  enable_test_env();
  const src = make_source_project();
  const tgt = make_empty_target();
  const zip1 = path.join(os.tmpdir(), 'so-imp-lm1-' + Date.now() + '.zip');
  const zip2 = path.join(os.tmpdir(), 'so-imp-lm2-' + Date.now() + '.zip');
  await export_zip_from(src, zip1);
  await import_zip_to(tgt, zip1, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
  });
  fs.writeFileSync(
    path.join(tgt, 'backup/merged/library-v2.json'),
    '{"local_edit":true}',
    'utf8'
  );
  fs.writeFileSync(
    path.join(src, 'backup/merged/library-v2.json'),
    JSON.stringify({ remote: 3 }),
    'utf8'
  );
  await export_zip_from(src, zip2);
  const dr = await import_zip_to(tgt, zip2, { dry_run: true });
  assert.equal(dr.ok, false);
  assert.equal(dr.preview.handoff.scenario, 'local_modified');
  const authorization = dr.preview.manifest_sha256;
  const wrong = await import_zip_to(tgt, zip2, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
    authorized_local_modified_manifest_sha256: 'wrong-manifest',
  });
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason_zh, /SHA-256/);
  const no_confirm = await import_zip_to(tgt, zip2, {
    apply: true,
    authorized_local_modified_manifest_sha256: authorization,
  });
  assert.equal(no_confirm.ok, false);
  assert.equal(fs.readFileSync(path.join(tgt, REQUIRED_CORE[0]), 'utf8'), '{"local_edit":true}');
  const prompts = [];
  const authorized = await run_import_gui_flow({
    import_common: {
      project_root_override: tgt,
      input_zip: zip2,
      password_mode: 'stdin',
      stdin_password: TEST_PASSWORD,
    },
    project_root: tgt,
    log() {},
    ask_confirm: async function (prompt, expected) {
      prompts.push(expected);
      return true;
    },
  });
  assert.deepEqual(prompts, ['OVERWRITE', 'yes']);
  assert.equal(authorized.ok, true);
  assert.equal(authorized.applied, true);
  assert.equal(authorized.backup_verified, true);
  assert.equal(authorized.preview.handoff.authorized_local_modified.scenario, 'local_modified');
  assert.equal(fs.readFileSync(path.join(authorized.backup_run_dir, REQUIRED_CORE[0]), 'utf8'), '{"local_edit":true}');
  assert.equal(fs.readFileSync(path.join(tgt, REQUIRED_CORE[0]), 'utf8'), JSON.stringify({ remote: 3 }));
  fs.writeFileSync(path.join(tgt, REQUIRED_CORE[0]), '{"local_edit":true}');
  const normal_again = await import_zip_to(tgt, zip2, { dry_run: true });
  assert.equal(normal_again.ok, false);
  assert.equal(normal_again.preview.handoff.scenario, 'local_modified');
  const old_authorized = await import_zip_to(tgt, zip1, {
    dry_run: true,
    authorized_local_modified_manifest_sha256: (await import_zip_to(tgt, zip1, { dry_run: true })).preview.manifest_sha256,
  });
  assert.equal(old_authorized.ok, false);
  assert.ok(['handoff_chain_break', 'state_inconsistent'].includes(old_authorized.preview.handoff.scenario));
});

test('6. Manifest 損壞', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-bad-manifest-'));
  fs.writeFileSync(path.join(dir, 'export-manifest.json'), '{bad', 'utf8');
  const loaded = load_manifest_from_extract(dir);
  assert.equal(loaded.ok, false);
});

test('7. SHA-256 不一致', function () {
  enable_test_env();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-sha-bad-'));
  const manifest = {
    manifest_schema_version: 1,
    data_transfer_version: '1.0.0',
    exported_at: new Date().toISOString(),
    source_git_commit: null,
    profile: 'minimal',
    file_count: 1,
    total_bytes: 2,
    files: [
      {
        path: 'backup/merged/library-v2.json',
        size: 999,
        sha256: 'deadbeef',
      },
    ],
  };
  fs.mkdirSync(path.join(dir, 'backup/merged'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'export-manifest.json'),
    JSON.stringify(manifest),
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'backup/merged/library-v2.json'), '{}', 'utf8');
  const v = run_full_import_extract_verification(dir, manifest);
  assert.equal(v.ok, false);
});

test('8. 路徑穿越拒絕', function () {
  const check = normalize_and_validate_import_member_path('../.env');
  assert.equal(check.ok, false);
});

test('9. 大小寫路徑衝突', function () {
  const col = detect_case_insensitive_path_collisions([
    'backup/Foo.json',
    'backup/foo.json',
  ]);
  assert.equal(col.ok, false);
});

test('10. 錯誤密碼', async function () {
  enable_test_env();
  const src = make_source_project();
  const zip = path.join(os.tmpdir(), 'so-imp-wpass-' + Date.now() + '.zip');
  await export_zip_from(src, zip);
  const bad = await import_zip_to(make_empty_target(), zip, {
    dry_run: true,
    stdin_password: 'wrong-password-here',
  });
  assert.equal(bad.ok, false);
});

test('11. 本機有資料無交接紀錄拒絕', async function () {
  enable_test_env();
  const src = make_source_project();
  const tgt = make_source_project();
  const zip = path.join(os.tmpdir(), 'so-imp-nostate-' + Date.now() + '.zip');
  await export_zip_from(src, zip);
  const dr = await import_zip_to(tgt, zip, { dry_run: true });
  assert.equal(dr.ok, false);
  assert.equal(dr.preview.handoff.scenario, 'local_data_no_state');
});

test('12. 備份與復原（含本次新增檔移除）', function () {
  enable_test_env();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'so-restore-'));
  const rel = 'backup/merged/library-v2.json';
  const abs = path.join(root, rel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, '{"before":1}', 'utf8');
  const backup_dir = path.join(root, '.data-sync-pre-import-backup/test-run');
  fs.mkdirSync(backup_dir, { recursive: true });
  const new_rel = 'imports/added-by-import.txt';
  const wr = write_pre_import_backup(root, backup_dir, [rel, new_rel]);
  assert.equal(wr.ok, true);
  fs.writeFileSync(abs, '{"after":2}', 'utf8');
  const new_abs = path.join(root, new_rel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(new_abs), { recursive: true });
  fs.writeFileSync(new_abs, 'new', 'utf8');
  restore_from_pre_import_backup(root, backup_dir, wr.meta);
  const h = hash_file_sha256_sync(abs);
  assert.equal(JSON.parse(fs.readFileSync(abs, 'utf8')).before, 1);
  assert.ok(h.sha256);
  assert.equal(
    fs.existsSync(path.join(root, new_rel.split('/').join(path.sep))),
    false
  );
});

test('13. Dry Run 不修改正式檔', async function () {
  enable_test_env();
  const src = make_source_project();
  const tgt = make_empty_target();
  const zip1 = path.join(os.tmpdir(), 'so-imp-dry1-' + Date.now() + '.zip');
  await export_zip_from(src, zip1);
  await import_zip_to(tgt, zip1, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
  });
  fs.writeFileSync(
    path.join(src, 'backup/merged/library-v2.json'),
    JSON.stringify({ id: 'dry-v2', v: 2 }),
    'utf8'
  );
  const zip2 = path.join(os.tmpdir(), 'so-imp-dry2-' + Date.now() + '.zip');
  await export_zip_from(src, zip2);
  const before = hash_file_sha256_sync(
    path.join(tgt, 'backup/merged/library-v2.json')
  );
  await import_zip_to(tgt, zip2, { dry_run: true });
  const after = hash_file_sha256_sync(
    path.join(tgt, 'backup/merged/library-v2.json')
  );
  assert.equal(before.sha256, after.sha256);
});

test('14. 不得使用 workCase ZIP 路徑', function () {
  enable_test_env();
  const tgt = make_empty_target();
  const check = validate_zip_input_path(
    path.join(FORBIDDEN_ABSOLUTE_ROOTS[0], 'x.zip'),
    tgt
  );
  assert.equal(check.ok, false);
});

test('15. bundle ID 穩定', function () {
  const manifest = {
    manifest_schema_version: 1,
    profile: 'minimal',
    files: [{ path: 'a.txt', size: 1, sha256: 'abc' }],
  };
  const id1 = compute_bundle_id_from_manifest(manifest);
  const id2 = compute_bundle_id_from_manifest(manifest);
  assert.equal(id1, id2);
});

test('16. 匯入後驗證失敗還原', function () {
  enable_test_env();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'so-post-fail-'));
  const rel = 'backup/merged/library-v2.json';
  const abs = path.join(root, rel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, '{"keep":1}', 'utf8');
  const backup_dir = path.join(root, '.data-sync-pre-import-backup/run2');
  fs.mkdirSync(backup_dir, { recursive: true });
  const wr = write_pre_import_backup(root, backup_dir, [rel]);
  fs.writeFileSync(abs, '{"broken":1}', 'utf8');
  restore_from_pre_import_backup(root, backup_dir, wr.meta);
  assert.match(fs.readFileSync(abs, 'utf8'), /keep/);
});

test('17. 不寫入 .env', async function () {
  enable_test_env();
  const src = make_source_project();
  const tgt = make_empty_target();
  const env_path = path.join(tgt, '.env');
  fs.writeFileSync(env_path, 'SPOTIFY_CLIENT_ID=test_only', 'utf8');
  const env_before = fs.readFileSync(env_path, 'utf8');
  const zip = path.join(os.tmpdir(), 'so-imp-env-' + Date.now() + '.zip');
  await export_zip_from(src, zip);
  await import_zip_to(tgt, zip, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
  });
  assert.equal(fs.readFileSync(env_path, 'utf8'), env_before);
});

test('18. handoff 衝突邏輯', function () {
  const r = evaluate_import_handoff({
    manifest: { handoff_previous_bundle_id: 'shared-parent' },
    bundle_id: 'incoming-from-other-pc',
    import_state: {
      last_bundle_id: 'shared-parent',
      file_baselines: {},
    },
    export_state: {
      last_bundle_id: 'my-local-export',
      handoff_previous_bundle_id: 'shared-parent',
      file_baselines: {},
    },
    file_rows: [],
    project_has_sync_relevant_files: true,
  });
  assert.equal(r.scenario, 'handoff_branch');
});

test('19. 雙電腦往返 家→公司→家→公司', async function () {
  enable_test_env();
  const home = make_source_project();
  const company = make_empty_target();
  const ts = Date.now();
  const zip_a = path.join(os.tmpdir(), 'so-rt-a-' + ts + '.zip');
  const zip_b = path.join(os.tmpdir(), 'so-rt-b-' + ts + '.zip');
  const zip_c = path.join(os.tmpdir(), 'so-rt-c-' + ts + '.zip');

  const ex_a = await export_zip_from(home, zip_a);
  assert.equal(ex_a.ok, true);

  const co_a = await import_zip_to(company, zip_a, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
  });
  assert.equal(co_a.ok, true);

  fs.writeFileSync(
    path.join(company, 'backup/merged/library-v2.json'),
    JSON.stringify({ site: 'company', v: 2 }),
    'utf8'
  );
  const ex_b = await export_zip_from(company, zip_b);
  assert.equal(ex_b.ok, true);

  const ho_b_dr = await import_zip_to(home, zip_b, { dry_run: true });
  assert.equal(ho_b_dr.ok, true);
  assert.equal(ho_b_dr.preview.handoff.scenario, 'export_handoff_continuation');

  const ho_b = await import_zip_to(home, zip_b, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
  });
  assert.equal(ho_b.ok, true);

  fs.writeFileSync(
    path.join(home, 'backup/merged/library-v2.json'),
    JSON.stringify({ site: 'home', v: 3 }),
    'utf8'
  );
  const ex_c = await export_zip_from(home, zip_c);
  assert.equal(ex_c.ok, true);

  const co_c_dr = await import_zip_to(company, zip_c, { dry_run: true });
  assert.equal(co_c_dr.ok, true);
  assert.equal(co_c_dr.preview.handoff.scenario, 'continuation_ok');

  const co_c = await import_zip_to(company, zip_c, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
  });
  assert.equal(co_c.ok, true);
  const lib = JSON.parse(
    fs.readFileSync(
      path.join(company, 'backup/merged/library-v2.json'),
      'utf8'
    )
  );
  assert.equal(lib.site, 'home');
  assert.equal(lib.v, 3);
});

test('20. 多日匯出：略過 ZIP A，公司直接匯入最新 ZIP B', async function () {
  enable_test_env();
  const home = make_source_project();
  const company = make_empty_target();
  const ts = Date.now();
  const zip_a = path.join(os.tmpdir(), 'so-md-a-' + ts + '.zip');
  const zip_b = path.join(os.tmpdir(), 'so-md-b-' + ts + '.zip');
  const zip_c = path.join(os.tmpdir(), 'so-md-c-' + ts + '.zip');

  await export_zip_from(home, zip_a);
  assert.ok(fs.existsSync(zip_a));
  fs.writeFileSync(
    path.join(home, 'backup/merged/library-v2.json'),
    JSON.stringify({ day: 2, v: 2 }),
    'utf8'
  );
  await export_zip_from(home, zip_b);
  assert.ok(fs.existsSync(zip_b));

  const co_b_dr = await import_zip_to(company, zip_b, { dry_run: true });
  assert.equal(co_b_dr.ok, true);
  assert.equal(co_b_dr.preview.handoff.scenario, 'first_import');

  await import_zip_to(company, zip_b, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
  });

  fs.writeFileSync(
    path.join(company, 'backup/merged/library-v2.json'),
    JSON.stringify({ site: 'company', v: 3 }),
    'utf8'
  );
  await export_zip_from(company, zip_c);

  const ho_c_dr = await import_zip_to(home, zip_c, { dry_run: true });
  assert.equal(ho_c_dr.ok, true);
  assert.equal(ho_c_dr.preview.handoff.scenario, 'export_handoff_continuation');
});

test('21. 家裡匯出 B 後又修改資料，匯入 C 應拒絕', async function () {
  enable_test_env();
  const home = make_source_project();
  const company = make_empty_target();
  const ts = Date.now();
  const zip_b = path.join(os.tmpdir(), 'so-md-b2-' + ts + '.zip');
  const zip_c = path.join(os.tmpdir(), 'so-md-c2-' + ts + '.zip');

  await export_zip_from(home, zip_b);
  await import_zip_to(company, zip_b, {
    apply: true,
    confirm_token: 'I_UNDERSTAND_DATA_SYNC_IMPORT',
  });
  fs.writeFileSync(
    path.join(company, 'backup/merged/library-v2.json'),
    JSON.stringify({ remote: 9 }),
    'utf8'
  );
  await export_zip_from(company, zip_c);

  fs.writeFileSync(
    path.join(home, 'backup/merged/library-v2.json'),
    JSON.stringify({ local_edit: true }),
    'utf8'
  );

  const dr = await import_zip_to(home, zip_c, { dry_run: true });
  assert.equal(dr.ok, false);
  assert.equal(dr.preview.handoff.scenario, 'local_modified');
});

test('22. 連續匯出相同資料（不同 ZIP 檔名）', async function () {
  enable_test_env();
  const home = make_source_project();
  const ts = Date.now();
  const zip1 = path.join(os.tmpdir(), 'so-dup-ex1-' + ts + '.zip');
  const zip2 = path.join(os.tmpdir(), 'so-dup-ex2-' + ts + '.zip');
  const ex1 = await export_zip_from(home, zip1);
  const ex2 = await export_zip_from(home, zip2);
  assert.equal(ex1.ok, true);
  assert.equal(ex2.ok, true);
  assert.equal(ex1.bundle_id, ex2.bundle_id);
  assert.ok(fs.existsSync(zip1));
  assert.ok(fs.existsSync(zip2));
});

test('23. 空白專案匯入含 handoff 的 ZIP（first_import）', function () {
  const r = evaluate_import_handoff({
    manifest: { handoff_previous_bundle_id: 'parent-bundle-a' },
    bundle_id: 'bundle-b-latest',
    import_state: null,
    export_state: null,
    file_rows: [],
    project_has_sync_relevant_files: false,
  });
  assert.equal(r.ok, true);
  assert.equal(r.scenario, 'first_import');
});

test('24. 僅沙箱 override 且無 sync_env 時 env 模式不得從 Temp 讀密碼', async function () {
  enable_test_env();
  const src = make_source_project();
  const zip = path.join(os.tmpdir(), 'so-imp-sbox-env-' + Date.now() + '.zip');
  await export_zip_from(src, zip);
  delete process.env.DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN;
  const anchor = resolve_project_root_from_anchor();
  const sandbox = create_unique_acceptance_sandbox(anchor);
  const dr = await run_data_import({
    project_root_override: sandbox.sandbox_real,
    input_zip: zip,
    dry_run: true,
    password_mode: 'env',
  });
  assert.equal(dr.ok, false);
  assert.match(dr.reason_zh || '', /沙箱|DATA_SYNC_ZIP_PASSWORD|\.env/);
  remove_acceptance_sandbox_safely(
    sandbox.sandbox_real,
    sandbox.sandbox_path
  );
});

test('25. sync_env 指向有 .env 的正式根、override 為空沙箱時 dry-run 可解密', async function () {
  enable_test_env();
  const formal = fs.mkdtempSync(path.join(os.tmpdir(), 'so-imp-formal-env-'));
  for (let j = 0; j < REQUIRED_CORE.length; j += 1) {
    const p = path.join(formal, REQUIRED_CORE[j].split('/').join(path.sep));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{}', 'utf8');
  }
  fs.writeFileSync(
    path.join(formal, '.env'),
    ENV_DATA_SYNC_ZIP_PASSWORD + '=' + TEST_PASSWORD + '\n',
    'utf8'
  );
  const src = make_source_project();
  const zip = path.join(os.tmpdir(), 'so-imp-sync-env-' + Date.now() + '.zip');
  await export_zip_from(src, zip);
  delete process.env.DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN;
  const anchor = resolve_project_root_from_anchor();
  const sandbox = create_unique_acceptance_sandbox(anchor);
  assert.equal(fs.existsSync(path.join(sandbox.sandbox_real, '.env')), false);
  const dr = await run_data_import({
    project_root_override: sandbox.sandbox_real,
    sync_env_project_root: formal,
    input_zip: zip,
    dry_run: true,
    password_mode: 'env',
  });
  assert.equal(dr.ok, true, dr.reason_zh || '');
  assert.equal(dr.preview.handoff.scenario, 'first_import');
  remove_acceptance_sandbox_safely(
    sandbox.sandbox_real,
    sandbox.sandbox_path
  );
  fs.rmSync(formal, { recursive: true, force: true });
});
