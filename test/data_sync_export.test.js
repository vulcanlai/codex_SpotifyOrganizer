/**
 * 資料同步匯出（minimal）安全與流程測試 — 獨立暫存假專案
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collect_minimal_export_files,
  should_exclude_relative_path,
} from '../lib/data_sync/export_profile_minimal.js';
import { validate_zip_output_path } from '../lib/data_sync/path_guard.js';
import { resolve_allowed_data_file_path } from '../lib/classification/manual_classify/safe_data_path.js';
import {
  run_data_export,
  remove_failed_export_zip_safe,
} from '../lib/data_sync/export_run.js';
import { hash_file_sha256_sync } from '../lib/data_sync/file_hash.js';
import {
  create_aes256_zip_from_staging as create_seven_zip_aes_from_staging,
  resolve_seven_zip_executable,
  resolve_seven_zip_for_export,
  parse_seven_zip_version_from_help,
  seven_zip_help_supports_aes256_zip,
  seven_zip_executable_supports_aes256_zip,
  validate_manual_seven_zip_path,
  resolve_seven_zip_password_stdio_mode,
} from '../lib/data_sync/seven_zip.js';
import {
  create_aes256_zip_from_staging,
  verify_zip_encryption_and_list,
} from '../lib/data_sync/wzaes_zip.js';
import { resolve_sync_zip_password, redact_sync_zip_secrets } from '../lib/data_sync/sync_zip_password.js';
import { ENV_ALLOW_7Z_PASSWORD_STDIN } from '../lib/data_sync/constants.js';
import { spawnSync } from 'node:child_process';
import { sync_export_state_file_path } from '../lib/data_sync/sync_state.js';
import {
  clear_data_sync_test_env_for_production_cli,
  assert_production_export_password_mode,
} from '../lib/data_sync/production_cli_guard.js';
import { verify_zip_contents_by_extract } from '../lib/data_sync/zip_content_verify.js';
import {
  create_export_staging_dir,
  materialize_staging_tree,
  safe_remove_staging_dir,
} from '../lib/data_sync/staging.js';
import { build_export_manifest } from '../lib/data_sync/manifest.js';
import { FORBIDDEN_ABSOLUTE_ROOTS } from '../lib/data_sync/constants.js';

const TEST_PASSWORD = 'test-export-password-only-for-temp';

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

function make_fake_project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'so-export-proj-'));
  const dirs = [
    'backup/merged',
    'backup/library',
    'backup/imported',
    'backup/enrichment',
    'backup/classification/g3-f1-wave-100/staged-candidates',
    'backup/classification/g3-f-adopt-snapshots',
    'reports/g3-f-adopt',
    'imports',
  ];
  for (let i = 0; i < dirs.length; i += 1) {
    fs.mkdirSync(path.join(root, dirs[i]), { recursive: true });
  }

  for (let j = 0; j < REQUIRED_CORE.length; j += 1) {
    const p = path.join(root, REQUIRED_CORE[j].split('/').join(path.sep));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ id: REQUIRED_CORE[j] }), 'utf8');
  }

  fs.writeFileSync(
    path.join(root, 'backup/classification/g3-f1-wave-100/wave-manifest.json'),
    '{"wave":1}',
    'utf8'
  );
  fs.writeFileSync(
    path.join(root, 'backup/classification/g3-f1-wave-100/offline-summary.json'),
    '{"staged_count":1}',
    'utf8'
  );
  fs.writeFileSync(
    path.join(root, 'imports/playlist.txt'),
    'spotify:track:abc',
    'utf8'
  );
  fs.writeFileSync(path.join(root, 'imports/README.md'), 'skip me', 'utf8');
  fs.writeFileSync(
    path.join(root, 'backup/enrichment/track-metadata-cache.json'),
    '{}',
    'utf8'
  );

  return root;
}

function write_all_required(root) {
  /* make_fake_project 已建立 */
  return root;
}

test('1. 正常檔案匯出（AES-256 + manifest 一致）', async function () {
  enable_test_env();
  const root = make_fake_project();
  const out_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-export-out-'));
  const zip_path = path.join(out_dir, 'pack.zip');

  const result = await run_data_export({
    project_root_override: root,
    output_zip: zip_path,
    profile: 'minimal',
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
  });

  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(zip_path));
  assert.ok(result.manifest.files.length >= REQUIRED_CORE.length);
});

test('2. 可選檔案不存在仍成功', async function () {
  enable_test_env();
  const root = make_fake_project();
  const out_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-export-out-'));
  const zip_path = path.join(out_dir, 'optional.zip');

  const result = await run_data_export({
    project_root_override: root,
    output_zip: zip_path,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
  });
  assert.equal(result.ok, true);
});

test('3. 必要檔案缺失時停止', async function () {
  enable_test_env();
  const root = make_fake_project();
  fs.unlinkSync(
    path.join(root, 'backup/merged/library-v2.json'.split('/').join(path.sep))
  );
  const out_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-export-out-'));
  const result = await run_data_export({
    project_root_override: root,
    output_zip: path.join(out_dir, 'bad.zip'),
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason_zh, /缺少必要/);
});

test('4. SHA-256 與 manifest 紀錄一致', function () {
  enable_test_env();
  const root = make_fake_project();
  const collected = collect_minimal_export_files(root);
  const rel = 'backup/merged/library-v2.json';
  assert.ok(collected.files.indexOf(rel) >= 0);
  const abs = path.join(root, rel.split('/').join(path.sep));
  const h = hash_file_sha256_sync(abs);
  const manifest = build_export_manifest({
    exported_at_iso: new Date().toISOString(),
    source_git_commit: null,
    profile: 'minimal',
    entries: [{ relative_path: rel, size: h.size, sha256: h.sha256 }],
  });
  assert.equal(manifest.files[0].sha256, h.sha256);
});

test('5. 匯出期間來源檔案改變應失敗', async function () {
  enable_test_env();
  const root = make_fake_project();
  const out_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-export-out-'));
  const zip_path = path.join(out_dir, 'race.zip');

  const target = path.join(root, 'backup/merged/library-v2.json');
  const original_create = create_aes256_zip_from_staging;
  let hooked = false;

  const result = await run_data_export({
    project_root_override: root,
    output_zip: zip_path,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
    seven_zip_hooks: {
      create: async function (opts) {
        hooked = true;
        fs.appendFileSync(target, '\n', 'utf8');
        return original_create(opts);
      },
      verify: verify_zip_encryption_and_list,
    },
  });

  assert.ok(hooked);
  assert.equal(result.ok, false);
  assert.match(result.reason_zh, /變更/);
});

test('6. 路徑穿越 .. 無法納入允許根', function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'so-path-'));
  const allowed = path.join(root, 'backup');
  fs.mkdirSync(allowed, { recursive: true });
  const secret = path.join(root, 'secret.json');
  fs.writeFileSync(secret, '{}', 'utf8');
  const traversal = path.join(allowed, '..', 'secret.json');
  assert.equal(resolve_allowed_data_file_path(traversal, [allowed]), null);
});

test('7. 絕對路徑在專案外不可讀', function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'so-path-'));
  const allowed = path.join(root, 'backup');
  fs.mkdirSync(allowed, { recursive: true });
  const outside = path.join(os.tmpdir(), 'so-outside-' + Date.now() + '.json');
  fs.writeFileSync(outside, '{}', 'utf8');
  assert.equal(resolve_allowed_data_file_path(outside, [allowed]), null);
  fs.unlinkSync(outside);
});

test('8. 符號連結指向根外應拒絕', function () {
  if (process.platform === 'win32') {
    return;
  }
  enable_test_env();
  const root = make_fake_project();
  const outside = path.join(path.dirname(root), 'outside-link-target.json');
  fs.writeFileSync(outside, '{"leak":true}', 'utf8');
  const link = path.join(root, 'backup/merged/evil-link.json');
  fs.symlinkSync(outside, link);
  assert.throws(function () {
    collect_minimal_export_files(root);
  });
  fs.unlinkSync(outside);
});

test('9. ZIP 輸出位置不安全（workCase）', function () {
  enable_test_env();
  const root = make_fake_project();
  const fake_workcase_zip = path.join(FORBIDDEN_ABSOLUTE_ROOTS[0], 'out.zip');
  const check = validate_zip_output_path(fake_workcase_zip, root);
  assert.equal(check.ok, false);
});

test('10. 已存在 ZIP 時拒絕覆寫', function () {
  enable_test_env();
  const root = make_fake_project();
  const out_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-export-out-'));
  const zip_path = path.join(out_dir, 'exists.zip');
  fs.writeFileSync(zip_path, 'old', 'utf8');
  const check = validate_zip_output_path(zip_path, root);
  assert.equal(check.ok, false);
});

test('11. 7-Zip 加密失敗時刪除無效 ZIP', async function () {
  enable_test_env();
  const root = make_fake_project();
  const out_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-export-out-'));
  const zip_path = path.join(out_dir, 'fail.zip');

  const result = await run_data_export({
    project_root_override: root,
    output_zip: zip_path,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
    seven_zip_hooks: {
      executable: '7z-missing',
      create: function () {
        return { ok: false, reason_zh: '模擬 7-Zip 失敗' };
      },
      verify: function () {
        return { ok: false, reason_zh: '不應執行', entries: [] };
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(zip_path), false);
});

test('12. 正式模式禁止 stdin 密碼', function () {
  const prev = process.env.DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN;
  delete process.env.DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN;
  const root = make_fake_project();
  const res = resolve_sync_zip_password(root, 'stdin', TEST_PASSWORD);
  assert.equal(res.ok, false);
  if (prev) {
    process.env.DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN = prev;
  }
});

test('13. ZIP 內容與 manifest 不一致時失敗', async function () {
  enable_test_env();
  const root = make_fake_project();
  const out_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-export-out-'));
  const zip_path = path.join(out_dir, 'mismatch.zip');

  const result = await run_data_export({
    project_root_override: root,
    output_zip: zip_path,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
    seven_zip_hooks: {
      create: create_aes256_zip_from_staging,
      verify: async function () {
        return {
          ok: true,
          entries: [{ path: 'export-manifest.json', size: 1 }],
        };
      },
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason_zh, /不一致|缺少/);
});

test('14. 排除規則不納入 snapshots／.env', function () {
  assert.equal(should_exclude_relative_path('backup/classification/snapshots/x.json'), true);
  assert.equal(should_exclude_relative_path('.env'), true);
  assert.equal(should_exclude_relative_path('imports/foo.txt'), false);
  assert.equal(should_exclude_relative_path('imports/README.md'), true);
});

test('16. 密碼錯誤時列表／驗證失敗', async function () {
  enable_test_env();
  const root = make_fake_project();
  const out_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-export-out-'));
  const zip_path = path.join(out_dir, 'wrong-pass.zip');
  const packed = await run_data_export({
    project_root_override: root,
    output_zip: zip_path,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
  });
  assert.equal(packed.ok, true);
  const bad = await verify_zip_encryption_and_list({
    zip_path: zip_path,
    password: 'wrong-password-value',
  });
  assert.equal(bad.ok, false);
});

test('17. 解壓 SHA-256 與 manifest 一致（非只比對來源）', async function () {
  enable_test_env();
  const root = make_fake_project();
  const out_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-export-out-'));
  const zip_path = path.join(out_dir, 'extract-verify.zip');
  const result = await run_data_export({
    project_root_override: root,
    output_zip: zip_path,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
  });
  assert.equal(result.ok, true);
  const tamper = await verify_zip_contents_by_extract({
    zip_path: zip_path,
    manifest: result.manifest,
    password: TEST_PASSWORD,
  });
  assert.equal(tamper.ok, true);
});

test('18. 解析 7-Zip 版本字串', function () {
  const sample =
    '7-Zip 25.01 (x64) : Copyright (c) 1999-2025 Igor Pavlov : 2025-08-03';
  assert.equal(parse_seven_zip_version_from_help(sample), '25.01');
});

test('19. 7-Zip AES256 能力判定', function () {
  assert.equal(seven_zip_help_supports_aes256_zip('-mem=AES256'), true);
  assert.equal(seven_zip_help_supports_aes256_zip('ZipCrypto only'), false);
  const pf = process.env.ProgramFiles;
  if (pf) {
    const manual = path.join(pf, '7-Zip', '7z.exe');
    if (fs.existsSync(manual)) {
      assert.equal(seven_zip_executable_supports_aes256_zip(manual), true);
    }
  }
});

test('20. 手動 7z 路徑拒絕 workCase', function () {
  const check = validate_manual_seven_zip_path(
    path.join(FORBIDDEN_ABSOLUTE_ROOTS[0], '7z.exe')
  );
  assert.equal(check.ok, false);
});

test('21. 正式 CLI guard 清除測試 env', function () {
  process.env.DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN = '1';
  process.env.DATA_SYNC_ALLOW_PROJECT_ROOT_OVERRIDE = '1';
  clear_data_sync_test_env_for_production_cli();
  assert.equal(process.env.DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN, undefined);
  assert.equal(process.env.DATA_SYNC_ALLOW_PROJECT_ROOT_OVERRIDE, undefined);
  enable_test_env();
});

test('22. resolve_seven_zip_for_export 偵測本機 7-Zip', function () {
  const pf = process.env.ProgramFiles;
  if (!pf) {
    return;
  }
  const manual = path.join(pf, '7-Zip', '7z.exe');
  if (!fs.existsSync(manual)) {
    return;
  }
  const info = resolve_seven_zip_for_export({ manual_path: manual });
  assert.equal(info.ok, true);
  assert.ok(info.version);
  assert.equal(info.aes256_zip, true);
});

test('15. 專案內輸出必須在 .data-sync-out 下', function () {
  enable_test_env();
  const root = make_fake_project();
  const bad = path.join(root, 'pack.zip');
  const check_bad = validate_zip_output_path(bad, root);
  assert.equal(check_bad.ok, false);
  const good = path.join(root, '.data-sync-out', 'pack.zip');
  const check_good = validate_zip_output_path(good, root);
  assert.equal(check_good.ok, true);
});

test('23. 正式 env 模式拒絕測試密碼開關', function () {
  process.env[ENV_ALLOW_7Z_PASSWORD_STDIN] = '1';
  assert.throws(function () {
    assert_production_export_password_mode('env');
  });
  enable_test_env();
  assert.doesNotThrow(function () {
    assert_production_export_password_mode('stdin');
  });
});

test('24. Windows 7z t 無法以 Node pipe stdin 餵 -p 密碼（區分驗證程式錯誤）', function () {
  if (process.platform !== 'win32') {
    return;
  }
  enable_test_env();
  const seven = resolve_seven_zip_executable();
  if (!seven) {
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'so-7zt-pipe-'));
  const staging = path.join(tmp, 'stg');
  fs.mkdirSync(staging);
  fs.writeFileSync(path.join(staging, 'export-manifest.json'), '{}');
  const zip = path.join(tmp, 'pipe-test.zip');
  const pack = create_seven_zip_aes_from_staging({
    executable: seven,
    output_zip: zip,
    staging_root: staging,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
  });
  assert.equal(pack.ok, true);
  delete process.env[ENV_ALLOW_7Z_PASSWORD_STDIN];
  const piped = spawnSync(seven, ['t', '-p', zip], {
    input: TEST_PASSWORD + '\n',
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.notEqual(piped.status, 0, 'pipe stdin 不應通過 7z t');
  const argv_ok = spawnSync(seven, ['t', '-p' + TEST_PASSWORD, zip], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(argv_ok.status, 0, 'argv -p 應通過 7z t');
  enable_test_env();
});

test('25. 驗證失敗只刪本次 ZIP，保留同目錄既有檔', async function () {
  enable_test_env();
  const root = make_fake_project();
  const out_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-export-out-'));
  const decoy = path.join(out_dir, 'keep-decoy.zip');
  fs.writeFileSync(decoy, 'decoy-not-a-real-zip', 'utf8');
  const zip_path = path.join(out_dir, 'new-export.zip');
  const result = await run_data_export({
    project_root_override: root,
    output_zip: zip_path,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
    seven_zip_hooks: {
      verify: async function () {
        return { ok: false, reason_zh: 'hook verify fail', entries: [] };
      },
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason_zh, /ZIP 驗證失敗/);
  assert.equal(fs.existsSync(zip_path), false, '本次 ZIP 應被清理');
  assert.equal(fs.existsSync(decoy), true, '同目錄既有檔不得刪除');
});

test('26. 損壞 ZIP 驗證失敗（非僅密碼錯誤訊息）', async function () {
  enable_test_env();
  const bad = path.join(os.tmpdir(), 'so-corrupt-' + Date.now() + '.zip');
  fs.writeFileSync(bad, 'not-a-valid-zip', 'utf8');
  const r = await verify_zip_encryption_and_list({
    zip_path: bad,
    password: TEST_PASSWORD,
  });
  assert.equal(r.ok, false);
  assert.notEqual(r.reason_zh, 'ZIP 密碼錯誤');
  fs.unlinkSync(bad);
});

test('27. 驗證失敗不寫入 export 交接狀態', async function () {
  enable_test_env();
  const root = make_fake_project();
  const state_file = sync_export_state_file_path(root);
  const out_dir = path.join(root, '.data-sync-out');
  fs.mkdirSync(out_dir, { recursive: true });
  const zip_path = path.join(out_dir, 'no-state-write.zip');
  const result = await run_data_export({
    project_root_override: root,
    output_zip: zip_path,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
    seven_zip_hooks: {
      verify: async function () {
        return { ok: false, reason_zh: 'hook verify fail', entries: [] };
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(state_file), false);
});

test('28. 密碼遮蔽不含明文', function () {
  const secret = 'unit-test-secret-value';
  const scrubbed = redact_sync_zip_secrets(
    'failed with password=' + secret + ' tail',
    secret
  );
  assert.equal(scrubbed.indexOf(secret), -1);
  assert.match(scrubbed, /REDACTED|已省略/);
});

test('30. remove_failed_export_zip_safe 刪除不存在檔案不報錯', function () {
  assert.equal(
    remove_failed_export_zip_safe(path.join(os.tmpdir(), 'so-no-such-zip.zip')),
    null
  );
});

test('29. env 模式缺少 .env 時明確失敗', async function () {
  const prev = process.env.DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN;
  delete process.env.DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN;
  process.env.DATA_SYNC_ALLOW_PROJECT_ROOT_OVERRIDE = '1';
  const root = make_fake_project();
  const out_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-export-out-'));
  const result = await run_data_export({
    project_root_override: root,
    output_zip: path.join(out_dir, 'no-env.zip'),
    password_mode: 'env',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason_zh, /DATA_SYNC_ZIP_PASSWORD|\.env/);
  if (prev) {
    process.env.DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN = prev;
  }
});
