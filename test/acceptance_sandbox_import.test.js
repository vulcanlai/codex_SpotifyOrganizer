/**
 * 模擬公司端匯入驗收工具測試（假專案／TEMP）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run_data_export } from '../lib/data_sync/export_run.js';
import { run_acceptance_company_import } from '../lib/data_sync/acceptance_company_import.js';
import {
  validate_acceptance_sandbox_path,
  create_unique_acceptance_sandbox,
  remove_acceptance_sandbox_safely,
  snapshot_formal_sync_guard,
} from '../lib/data_sync/acceptance_sandbox.js';
import { resolve_project_root_from_anchor } from '../lib/data_sync/project_root.js';
import { run_data_import } from '../lib/data_sync/import_run.js';
import { ENV_DATA_SYNC_ZIP_PASSWORD } from '../lib/data_sync/constants.js';

const TEST_PASSWORD = 'test-acceptance-password';

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

/** env 模式驗收（模擬正式 GUI／CLI，不得啟用 stdin 測試開關） */
function enable_acceptance_env_mode() {
  process.env.DATA_SYNC_ALLOW_PROJECT_ROOT_OVERRIDE = '1';
  delete process.env.DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN;
}

function make_source_project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'so-acc-src-'));
  for (let j = 0; j < REQUIRED_CORE.length; j += 1) {
    const p = path.join(root, REQUIRED_CORE[j].split('/').join(path.sep));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ id: REQUIRED_CORE[j], v: 1 }), 'utf8');
  }
  fs.mkdirSync(path.join(root, 'imports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'imports/a.txt'), 'track', 'utf8');
  return root;
}

function make_formal_guard_clone() {
  return make_source_project();
}

function write_test_env_password(project_root, password) {
  fs.writeFileSync(
    path.join(project_root, '.env'),
    ENV_DATA_SYNC_ZIP_PASSWORD + '=' + password + '\n',
    'utf8'
  );
}

function assert_dir_has_no_env_file(dir) {
  const env_path = path.join(dir, '.env');
  assert.equal(fs.existsSync(env_path), false);
}

function walk_for_env_files(dir) {
  /** @type {string[]} */
  const found = [];
  if (!fs.existsSync(dir)) {
    return found;
  }
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    const names = fs.readdirSync(cur);
    for (let i = 0; i < names.length; i += 1) {
      const abs = path.join(cur, names[i]);
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) {
        stack.push(abs);
      } else if (names[i] === '.env') {
        found.push(abs);
      }
    }
  }
  return found;
}

async function export_zip_from(root, zip_path) {
  return run_data_export({
    project_root_override: root,
    output_zip: zip_path,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
  });
}

test('1. 正常加密 ZIP → 沙箱匯入成功', async function () {
  enable_test_env();
  const src = make_source_project();
  const formal = make_formal_guard_clone();
  const zip = path.join(os.tmpdir(), 'so-acc-ok-' + Date.now() + '.zip');
  const ex = await export_zip_from(src, zip);
  assert.equal(ex.ok, true);

  const r = await run_acceptance_company_import({
    input_zip: zip,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
    skip_user_confirm: true,
    formal_guard_root: formal,
    cleanup_on_success: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.outcome, 'success');
  assert.ok(r.file_count > 0);
});

test('2. 成功後沙箱自動刪除', async function () {
  enable_test_env();
  const src = make_source_project();
  const formal = make_formal_guard_clone();
  const zip = path.join(os.tmpdir(), 'so-acc-cln-' + Date.now() + '.zip');
  await export_zip_from(src, zip);

  let kept_sandbox = null;
  const r = await run_acceptance_company_import({
    input_zip: zip,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
    skip_user_confirm: true,
    formal_guard_root: formal,
    cleanup_on_success: true,
    log: function () {},
  });
  assert.equal(r.ok, true);
  kept_sandbox = r.sandbox_real;
  assert.equal(kept_sandbox, null);
});

test('3. ZIP 密碼錯誤', async function () {
  enable_test_env();
  const src = make_source_project();
  const formal = make_formal_guard_clone();
  const zip = path.join(os.tmpdir(), 'so-acc-wp-' + Date.now() + '.zip');
  await export_zip_from(src, zip);
  const before = snapshot_formal_sync_guard(formal);

  const r = await run_acceptance_company_import({
    input_zip: zip,
    password_mode: 'stdin',
    stdin_password: 'wrong-password-value',
    skip_user_confirm: true,
    formal_guard_root: formal,
    cleanup_on_success: true,
    log: function () {},
  });
  assert.equal(r.ok, false);
  assert.ok(r.sandbox_real);
  assert.ok(fs.existsSync(r.sandbox_real));

  const after = snapshot_formal_sync_guard(formal);
  assert.deepEqual(before.files, after.files);
});

test('4. ZIP 損壞', async function () {
  enable_test_env();
  const formal = make_formal_guard_clone();
  const bad = path.join(os.tmpdir(), 'so-acc-bad-' + Date.now() + '.zip');
  fs.writeFileSync(bad, 'not-a-real-zip-file-content', 'utf8');

  const r = await run_acceptance_company_import({
    input_zip: bad,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
    skip_user_confirm: true,
    formal_guard_root: formal,
    log: function () {},
  });
  assert.equal(r.ok, false);
});

test('5. SHA-256 不一致（匯入管線拒絕）', async function () {
  enable_test_env();
  const src = make_source_project();
  const formal = make_formal_guard_clone();
  const zip = path.join(os.tmpdir(), 'so-acc-sha-' + Date.now() + '.zip');
  await export_zip_from(src, zip);
  const buf = fs.readFileSync(zip);
  const truncated = buf.subarray(0, Math.max(0, buf.length - 200));
  const tampered = path.join(os.tmpdir(), 'so-acc-tam-' + Date.now() + '.zip');
  fs.writeFileSync(tampered, truncated);

  const r = await run_acceptance_company_import({
    input_zip: tampered,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
    skip_user_confirm: true,
    formal_guard_root: formal,
    log: function () {},
  });
  assert.equal(r.ok, false);
});

test('6. 沙箱路徑不安全（等於正式根）', function () {
  const anchor = resolve_project_root_from_anchor();
  const check = validate_acceptance_sandbox_path(anchor, anchor);
  assert.equal(check.ok, false);
});

test('7. 沙箱必須在 TEMP 且具前綴', function () {
  const anchor = resolve_project_root_from_anchor();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'so-wrong-prefix-'));
  const check = validate_acceptance_sandbox_path(outside, anchor);
  assert.equal(check.ok, false);
  fs.rmSync(outside, { recursive: true, force: true });
});

test('8. 匯入失敗保留沙箱', async function () {
  enable_test_env();
  const formal = make_formal_guard_clone();
  const r = await run_acceptance_company_import({
    input_zip: path.join(os.tmpdir(), 'missing-' + Date.now() + '.zip'),
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
    skip_user_confirm: true,
    formal_guard_root: formal,
    log: function () {},
  });
  assert.equal(r.ok, false);
  assert.equal(r.sandbox_path, null);
});

test('9. 使用者取消確認', async function () {
  enable_test_env();
  const src = make_source_project();
  const formal = make_formal_guard_clone();
  const zip = path.join(os.tmpdir(), 'so-acc-cancel-' + Date.now() + '.zip');
  await export_zip_from(src, zip);

  const r = await run_acceptance_company_import({
    input_zip: zip,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
    skip_user_confirm: false,
    ask_continue: async function () {
      return false;
    },
    formal_guard_root: formal,
    log: function () {},
  });
  assert.equal(r.outcome, 'cancelled');
  assert.ok(r.sandbox_real);
});

test('10. 正式 guard 資料不受影響', async function () {
  enable_test_env();
  const src = make_source_project();
  const formal = make_formal_guard_clone();
  const marker = path.join(formal, 'backup/merged/library-v2.json');
  const hash_before = fs.readFileSync(marker, 'utf8');
  const zip = path.join(os.tmpdir(), 'so-acc-guard-' + Date.now() + '.zip');
  await export_zip_from(src, zip);

  const r = await run_acceptance_company_import({
    input_zip: zip,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
    skip_user_confirm: true,
    formal_guard_root: formal,
    cleanup_on_success: true,
    log: function () {},
  });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(marker, 'utf8'), hash_before);
});

test('11. 安全清理僅限本次沙箱', function () {
  enable_test_env();
  const anchor = resolve_project_root_from_anchor();
  const sandbox = create_unique_acceptance_sandbox(anchor);
  const marker = path.join(sandbox.sandbox_real, 'probe.txt');
  fs.writeFileSync(marker, 'x', 'utf8');
  const rm = remove_acceptance_sandbox_safely(
    sandbox.sandbox_real,
    sandbox.sandbox_path
  );
  assert.equal(rm.ok, true);
  assert.equal(fs.existsSync(sandbox.sandbox_real), false);
});

test('12. 禁止清理非沙箱前綴目錄', function () {
  const anchor = resolve_project_root_from_anchor();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'so-not-prefix-'));
  const fake = validate_acceptance_sandbox_path(temp, anchor);
  assert.equal(fake.ok, false);
  const rm = remove_acceptance_sandbox_safely(temp, temp);
  assert.equal(rm.ok, false);
  fs.rmSync(temp, { recursive: true, force: true });
});

test('A. 正式根 .env 有密碼、沙箱無 .env，env 模式驗收成功', async function () {
  enable_test_env();
  const src = make_source_project();
  const formal = make_formal_guard_clone();
  write_test_env_password(formal, TEST_PASSWORD);
  const zip = path.join(os.tmpdir(), 'so-acc-env-ok-' + Date.now() + '.zip');
  await export_zip_from(src, zip);
  enable_acceptance_env_mode();

  const r = await run_acceptance_company_import({
    input_zip: zip,
    password_mode: 'env',
    skip_user_confirm: true,
    formal_guard_root: formal,
    cleanup_on_success: true,
    log: function () {},
  });
  assert.equal(r.ok, true, r.reason_zh || '');
  assert.equal(r.outcome, 'success');
});

test('B. 正式根缺少 .env 密碼時 env 模式安全失敗', async function () {
  enable_test_env();
  const src = make_source_project();
  const formal = make_formal_guard_clone();
  const zip = path.join(os.tmpdir(), 'so-acc-no-env-' + Date.now() + '.zip');
  await export_zip_from(src, zip);
  enable_acceptance_env_mode();

  const r = await run_acceptance_company_import({
    input_zip: zip,
    password_mode: 'env',
    skip_user_confirm: true,
    formal_guard_root: formal,
    log: function () {},
  });
  assert.equal(r.ok, false);
  assert.match(r.reason_zh || '', /DATA_SYNC_ZIP_PASSWORD|\.env/);
});

test('C. env 密碼錯誤時失敗且不修改 formal guard', async function () {
  enable_test_env();
  const src = make_source_project();
  const formal = make_formal_guard_clone();
  write_test_env_password(formal, 'wrong-env-password-value');
  const zip = path.join(os.tmpdir(), 'so-acc-env-wp-' + Date.now() + '.zip');
  await export_zip_from(src, zip);
  enable_acceptance_env_mode();
  const before = snapshot_formal_sync_guard(formal);

  const r = await run_acceptance_company_import({
    input_zip: zip,
    password_mode: 'env',
    skip_user_confirm: true,
    formal_guard_root: formal,
    log: function () {},
  });
  assert.equal(r.ok, false);
  const after = snapshot_formal_sync_guard(formal);
  assert.deepEqual(before.files, after.files);
});

test('D. 沙箱內不建立 .env 或殘留密碼檔', async function () {
  enable_test_env();
  const src = make_source_project();
  const formal = make_formal_guard_clone();
  write_test_env_password(formal, TEST_PASSWORD);
  const zip = path.join(os.tmpdir(), 'so-acc-no-leak-' + Date.now() + '.zip');
  await export_zip_from(src, zip);
  enable_acceptance_env_mode();

  const anchor = resolve_project_root_from_anchor();
  const sandbox = create_unique_acceptance_sandbox(anchor);
  assert_dir_has_no_env_file(sandbox.sandbox_real);

  const dry = await run_data_import({
    project_root_override: sandbox.sandbox_real,
    sync_env_project_root: formal,
    input_zip: zip,
    dry_run: true,
    password_mode: 'env',
  });
  assert.equal(dry.ok, true, dry.reason_zh || '');
  assert_dir_has_no_env_file(sandbox.sandbox_real);
  assert.equal(walk_for_env_files(sandbox.sandbox_real).length, 0);

  remove_acceptance_sandbox_safely(
    sandbox.sandbox_real,
    sandbox.sandbox_path
  );
});

test('E. CLI 與 GUI 共用 acceptance 的 sync_env_project_root', async function () {
  enable_test_env();
  const formal = make_formal_guard_clone();
  write_test_env_password(formal, TEST_PASSWORD);
  const src = make_source_project();
  const zip = path.join(os.tmpdir(), 'so-acc-shared-' + Date.now() + '.zip');
  await export_zip_from(src, zip);
  enable_acceptance_env_mode();

  const cli = await run_acceptance_company_import({
    input_zip: zip,
    password_mode: 'env',
    skip_user_confirm: true,
    formal_guard_root: formal,
    cleanup_on_success: true,
    log: function () {},
  });
  assert.equal(cli.ok, true, cli.reason_zh || '');

  const gui_equiv = await run_acceptance_company_import({
    input_zip: zip,
    password_mode: 'env',
    skip_user_confirm: true,
    formal_guard_root: formal,
    cleanup_on_success: true,
    log: function () {},
  });
  assert.equal(gui_equiv.ok, true);
});
