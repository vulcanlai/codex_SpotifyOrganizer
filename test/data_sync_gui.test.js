/**
 * GUI 輔助（路徑、預覽文字）— 不開啟實際 Windows 視窗
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { format_import_preview_zh } from '../lib/data_sync/import_gui_messages.js';
import { run_import_gui_flow } from '../lib/data_sync/import_gui_flow.js';
import { validate_zip_output_path } from '../lib/data_sync/path_guard.js';
import { resolve_project_root_from_anchor } from '../lib/data_sync/project_root.js';
import { FORBIDDEN_ABSOLUTE_ROOTS } from '../lib/data_sync/constants.js';
import {
  map_ps_exit_for_test,
  build_powershell_picker_argv,
  build_import_zip_open_picker_extra_args,
  resolve_in_project_zip_picker_initial_directory,
  run_open_file_dialog_probe,
  sanitize_powershell_diagnostic,
  test_winforms_picker_init,
} from '../lib/data_sync/win_file_dialog.js';
import { IN_PROJECT_ZIP_OUTPUT_DIR } from '../lib/data_sync/constants.js';
import { read_gui_pick_result_file } from '../lib/data_sync/gui_pick_result.js';
import {
  resolve_gui_launcher_paths,
  verify_default_gui_launcher_paths,
} from '../lib/data_sync/gui_launcher_paths.js';
import {
  build_gui_pick_trace_log_filename,
  write_gui_pick_trace_pointer,
  verify_gui_pick_trace_latest_pointer,
  GUI_PICK_TRACE_LATEST_POINTER,
} from '../lib/data_sync/gui_pick_trace.js';

/**
 * @param {Buffer} buf
 */
function assert_phase2_bat_cmd_safe_bytes(buf) {
  if (
    buf.length >= 3 &&
    buf[0] === 0xef &&
    buf[1] === 0xbb &&
    buf[2] === 0xbf
  ) {
    assert.fail('run-gui-phase2.bat must not have UTF-8 BOM');
  }
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] > 127) {
      assert.fail('run-gui-phase2.bat non-ASCII byte at offset ' + i);
    }
    if (buf[i] === 0x0a && (i === 0 || buf[i - 1] !== 0x0d)) {
      assert.fail(
        'run-gui-phase2.bat must use CRLF (LF-only breaks CMD parsing) at ' + i
      );
    }
  }
}

test('GUI 授權只限選定 manifest，取消或其他安全錯誤均不寫入', async function () {
  const sha = 'a'.repeat(64);
  const local = { ok: false, preview: { manifest_sha256: sha, handoff: { scenario: 'local_modified' } } };
  const safe = { ok: true, preview: { handoff: { ok: true, allow_apply: true } } };
  for (const scenario of ['cancel-overwrite', 'cancel-apply', 'chain-break', 'success', 'other-error']) {
    const calls = [];
    const prompts = [];
    const result = await run_import_gui_flow({
      import_common: { input_zip: 'selected.zip' },
      project_root: 'target',
      log() {},
      ask_confirm: async function (prompt, expected) {
        prompts.push(expected);
        return !((scenario === 'cancel-overwrite' && expected === 'OVERWRITE') ||
          (scenario === 'cancel-apply' && expected === 'yes'));
      },
      run_import: async function (options) {
        calls.push(options);
        if (calls.length === 1) {
          return scenario === 'other-error'
            ? { ok: false, preview: { handoff: { scenario: 'unsafe_conflict' } } }
            : local;
        }
        assert.equal(options.input_zip, 'selected.zip');
        assert.equal(options.authorized_local_modified_manifest_sha256, sha);
        if (scenario === 'chain-break') return { ok: false, reason_zh: 'handoff_chain_break' };
        return options.apply ? { ok: true, applied: true, backup_verified: true } : safe;
      },
    });
    assert.equal(calls.some(c => c.apply), scenario === 'success');
    if (scenario.startsWith('cancel')) assert.equal(result.cancelled, true);
    if (scenario === 'chain-break' || scenario === 'other-error') assert.equal(result.ok, false);
    if (scenario === 'other-error') assert.deepEqual(prompts, []);
    if (scenario === 'success') {
      assert.deepEqual(prompts, ['OVERWRITE', 'yes']);
      assert.equal(calls[2].confirm_token, 'I_UNDERSTAND_DATA_SYNC_IMPORT');
      assert.equal(result.backup_verified, true);
    }
  }
});

test('1. 匯入預覽繁體中文格式', function () {
  const text = format_import_preview_zh(
    {
      zip_path: 'E:\\交接\\demo.zip',
      file_count: 8,
      would_add: 8,
      would_overwrite: 0,
      identical: 0,
      conflict_or_anomaly: 0,
      bundle_id: 'abc123',
      handoff_previous_bundle_id: null,
      handoff: {
        ok: true,
        scenario: 'first_import',
        reason_zh: '初次匯入',
        allow_apply: true,
      },
    },
    'D:\\SpotifyOrganizer'
  );
  assert.match(text, /ZIP 檔名：demo\.zip/);
  assert.match(text, /預計新增：8/);
  assert.match(text, /是否允許繼續：是/);
});

test('2. 已存在 ZIP 輸出路徑拒絕（模擬存檔選既有檔）', function () {
  const root = resolve_project_root_from_anchor();
  const existing = path.join(os.tmpdir(), 'so-gui-exist-' + Date.now() + '.zip');
  fs.writeFileSync(existing, 'x', 'utf8');
  const check = validate_zip_output_path(existing, root);
  assert.equal(check.ok, false);
  assert.match(check.reason_zh, /已存在/);
  fs.unlinkSync(existing);
});

test('3. 不安全輸出路徑拒絕', function () {
  const root = resolve_project_root_from_anchor();
  const bad = path.join(FORBIDDEN_ABSOLUTE_ROOTS[0], 'out.zip');
  const check = validate_zip_output_path(bad, root);
  assert.equal(check.ok, false);
});

test('4. PowerShell 結束碼對應取消', function () {
  const c = map_ps_exit_for_test(2);
  assert.equal(c.cancelled, true);
});

test('5. PowerShell 啟動參數含 -STA', function () {
  const argv = build_powershell_picker_argv(
    'win-pick-save-zip.ps1',
    'C:\\Temp\\out.path',
    ['-TestInitOnly']
  );
  assert.ok(argv.indexOf('-STA') >= 0);
  assert.ok(argv.indexOf('-File') >= 0);
});

test('5b. 匯出 save PS1 相容 Windows PowerShell 5.1（ShowDialog OK 後寫結果）', function () {
  if (process.platform !== 'win32') {
    return;
  }
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  );
  const ps1_path = path.join(root, 'scripts', 'data-sync', 'win-pick-save-zip.ps1');
  const ps1 = fs.readFileSync(ps1_path, 'utf8');
  assert.match(
    ps1,
    /GetDirectoryName/,
    '應以 .NET GetDirectoryName 解析父資料夾'
  );
  const ps1_code = ps1
    .split(/\r?\n/)
    .filter(function (line) {
      return !/^\s*#/.test(line);
    })
    .join('\n');
  assert.equal(
    /Split-Path\s+-LiteralPath[^\r\n]+-Parent/.test(ps1_code),
    false,
    'PS 5.1 不允許 Split-Path -LiteralPath 與 -Parent 並用'
  );
  assert.match(ps1, /\[string\]\$TraceFile/, 'Trace 開啟時需接受 -TraceFile');
  const result_file = path.join(
    os.tmpdir(),
    'so-save-postok-' + Date.now() + '.path'
  );
  const picked = path.join(root, '.data-sync-out', 'spotify-handoff-unit.zip');
  const cmd =
    '$picked=' +
    JSON.stringify(picked) +
    ';$rf=' +
    JSON.stringify(result_file) +
    ';$dir=[System.IO.Path]::GetDirectoryName($picked);' +
    'if($dir -and -not (Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null};' +
    '$enc=New-Object System.Text.UTF8Encoding $false;' +
    '[System.IO.File]::WriteAllText($rf,$picked,$enc)';
  const run = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
    { encoding: 'utf8', timeout: 60000 }
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(
    path.normalize(fs.readFileSync(result_file, 'utf8').trim()),
    path.normalize(picked)
  );
  fs.unlinkSync(result_file);
});

test('6. 診斷訊息過濾敏感字樣', function () {
  const s = sanitize_powershell_diagnostic(
    'fail token=secret123 password=abc .env path'
  );
  assert.match(s, /\[已省略\]/);
  assert.equal(s.indexOf('secret123'), -1);
});

test('7. 讀取 pick 結果 JSON 後刪除暫存', function () {
  const f = path.join(os.tmpdir(), 'so-pick-res-' + Date.now() + '.json');
  fs.writeFileSync(
    f,
    JSON.stringify({ ok: true, path: 'C:\\test\\a.zip', mode: 'export' }),
    'utf8'
  );
  const r = read_gui_pick_result_file(f);
  assert.equal(r.ok, true);
  assert.equal(r.path, 'C:\\test\\a.zip');
  assert.equal(fs.existsSync(f), false);
});

test('8. launcher 路徑解析與檔案存在', function () {
  const v = verify_default_gui_launcher_paths();
  assert.equal(v.ok, true, v.missing.join('; '));
  const p = v.paths;
  assert.match(p.gui_pick_only_js, /scripts[\\/]data-sync[\\/]gui-pick-only\.js$/);
  assert.match(p.run_gui_phase2_bat, /run-gui-phase2\.bat$/);
  assert.ok(
    p.gui_pick_only_js.indexOf('scripts\\data-sync\\scripts') === -1 &&
      p.gui_pick_only_js.indexOf('scripts/data-sync/scripts') === -1
  );
});

test('9. run-gui-launcher.vbs 語法與 __path_check__', function () {
  if (process.platform !== 'win32') {
    return;
  }
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  );
  const vbs = path.join(root, 'scripts', 'data-sync', 'run-gui-launcher.vbs');
  assert.ok(fs.existsSync(vbs));
  let run = spawnSync(
    'cscript.exe',
    ['//nologo', vbs, '__syntax_check__'],
    { encoding: 'utf8', timeout: 30000 }
  );
  assert.equal(
    run.status,
    0,
    (run.stderr || run.stdout || 'VBS syntax failed').slice(0, 500)
  );
  run = spawnSync(
    'cscript.exe',
    ['//nologo', vbs, '__path_check__'],
    { encoding: 'utf8', timeout: 30000 }
  );
  assert.equal(
    run.status,
    0,
    (run.stderr || run.stdout || 'VBS path check failed').slice(0, 500)
  );
});

test('10. VBS 能以絕對路徑啟動 gui-pick-only（不開視窗）', function () {
  if (process.platform !== 'win32') {
    return;
  }
  const paths = resolve_gui_launcher_paths(
    path.join(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
      'scripts',
      'data-sync',
      'run-gui-launcher.vbs'
    )
  );
  const run = spawnSync(
    'node.exe',
    [paths.gui_pick_only_js, '__launcher_ping__', 'ignored.json'],
    {
      encoding: 'utf8',
      cwd: paths.project_root,
      timeout: 30000,
      windowsHide: true,
    }
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout || '', /launcher_ping_ok/);
});

test('11. 含空白路徑仍可解析 launcher 檔案', function () {
  const fakeRoot = path.join(os.tmpdir(), 'so launcher 測試', 'proj');
  const vbsDir = path.join(fakeRoot, 'scripts', 'data-sync');
  fs.mkdirSync(vbsDir, { recursive: true });
  fs.writeFileSync(path.join(vbsDir, 'gui-pick-only.js'), '// stub', 'utf8');
  fs.writeFileSync(path.join(vbsDir, 'run-gui-phase2.bat'), '@echo off', 'utf8');
  const vbsFake = path.join(vbsDir, 'run-gui-launcher.vbs');
  fs.writeFileSync(vbsFake, 'stub', 'utf8');
  const p = resolve_gui_launcher_paths(vbsFake);
  assert.equal(fs.existsSync(p.gui_pick_only_js), true);
  assert.equal(fs.existsSync(p.run_gui_phase2_bat), true);
  fs.rmSync(path.join(os.tmpdir(), 'so launcher 測試'), {
    recursive: true,
    force: true,
  });
});

test('12. 匯入 Open 對話框傳遞 InitialDirectory（與匯出同目錄）', function () {
  const root = resolve_project_root_from_anchor();
  const initial = resolve_in_project_zip_picker_initial_directory();
  assert.equal(
    path.basename(initial),
    IN_PROJECT_ZIP_OUTPUT_DIR,
    '預設目錄應為 .data-sync-out'
  );
  assert.equal(
    path.dirname(initial),
    root,
    '預設目錄應在專案根下，非硬編碼磁碟路徑'
  );
  assert.equal(fs.existsSync(initial), true);

  const args = build_import_zip_open_picker_extra_args(
    '選擇要匯入 Spotify 工作資料的加密 ZIP'
  );
  const idx = args.indexOf('-InitialDirectory');
  assert.ok(idx >= 0, '應含 -InitialDirectory');
  assert.equal(args[idx + 1], initial);
  assert.ok(args.indexOf('-Title') >= 0);

  const argv = build_powershell_picker_argv(
    'win-pick-open-zip.ps1',
    'C:\\Temp\\out.path',
    args.concat(['-TestInitOnly'])
  );
  assert.ok(argv.indexOf('-InitialDirectory') >= 0);
  assert.ok(argv.indexOf(initial) >= 0);
});

test('13. import 與 acceptance 共用相同 Open 預設路徑參數', function () {
  const a = build_import_zip_open_picker_extra_args('匯入標題');
  const b = build_import_zip_open_picker_extra_args(
    '模擬公司端匯入測試：選擇加密 ZIP（不寫入正式專案）'
  );
  const dir_a = a[a.indexOf('-InitialDirectory') + 1];
  const dir_b = b[b.indexOf('-InitialDirectory') + 1];
  assert.equal(dir_a, dir_b);
  assert.equal(a[a.indexOf('-Title') + 1], '匯入標題');
  assert.match(b[b.indexOf('-Title') + 1], /模擬公司端匯入測試/);
});

test('14. Open probe 診斷（不 ShowDialog）', function () {
  if (process.platform !== 'win32') {
    return;
  }
  const trace = path.join(
    os.tmpdir(),
    'so-gui-pick-trace-test-' + Date.now() + '.log'
  );
  process.env.SO_GUI_PICK_TRACE = trace;
  process.env.SO_GUI_PICK_SKIP_INITIAL_DIR = '';
  const probe = run_open_file_dialog_probe('probe title');
  assert.equal(probe.ok, true, probe.reason_zh);
  assert.equal(fs.existsSync(trace), true);
  const text = fs.readFileSync(trace, 'utf8');
  assert.match(text, /open_probe_only_exit/);
  assert.match(text, /after_enable_visual_styles/);
  assert.equal(text.indexOf('after_show_dialog'), -1);
  fs.unlinkSync(trace);
  delete process.env.SO_GUI_PICK_TRACE;
  delete process.env.SO_GUI_PICK_SKIP_INITIAL_DIR;
});

test('15. trace log ASCII 檔名與 latest 指標可讀', function () {
  const log_path = build_gui_pick_trace_log_filename(os.tmpdir());
  assert.match(
    path.basename(log_path),
    /^so-gui-pick-trace-\d{8}-\d{6}\.log$/
  );
  fs.writeFileSync(log_path, '{"phase":"test_line"}\n', 'utf8');
  write_gui_pick_trace_pointer(log_path);
  const pointer = path.join(os.tmpdir(), GUI_PICK_TRACE_LATEST_POINTER);
  assert.equal(fs.readFileSync(pointer, 'utf8').trim(), log_path);
  const v = verify_gui_pick_trace_latest_pointer();
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.log_path, log_path);

  if (process.platform === 'win32') {
    const ps_script =
      "$lp=Join-Path $env:TEMP 'so-gui-pick-trace-latest.txt'; " +
      '$p=(Get-Content -LiteralPath $lp -Raw).Trim(); ' +
      'if (-not (Test-Path -LiteralPath $p)) { exit 2 }; ' +
      '(Get-Content -LiteralPath $p -TotalCount 1).Length';
    const run = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', ps_script],
      { encoding: 'utf8', timeout: 30000 }
    );
    assert.equal(
      run.status,
      0,
      (run.stderr || run.stdout || 'PS read failed').slice(0, 300)
    );
  }

  fs.unlinkSync(log_path);
  fs.unlinkSync(pointer);
});

test('16. WinForms 初始化（-STA，不開啟視窗）', function () {
  if (process.platform !== 'win32') {
    return;
  }
  const save = test_winforms_picker_init('save');
  const open = test_winforms_picker_init('open');
  assert.equal(
    save.ok,
    true,
    'SaveFileDialog init failed: ' + save.diagnostic
  );
  assert.equal(
    open.ok,
    true,
    'OpenFileDialog init failed: ' + open.diagnostic
  );
});

test('17. run-gui-phase2.bat 純 ASCII、CRLF，CMD 可解析', function () {
  if (process.platform !== 'win32') {
    return;
  }
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  );
  const bat = path.join(root, 'scripts', 'data-sync', 'run-gui-phase2.bat');
  const buf = fs.readFileSync(bat);
  assert_phase2_bat_cmd_safe_bytes(buf);
  const text = buf.toString('ascii');
  assert.match(text, /set "DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN="/);
  assert.match(text, /set "GUI_MODE=%~1"/);
  assert.match(text, /export-data-gui\.js/);
  const run = spawnSync('cmd.exe', ['/c', 'call', bat, '__syntax_check__'], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  assert.equal(
    run.status,
    0,
    (run.stderr || run.stdout || 'phase2 syntax check failed').slice(0, 400)
  );
});

test('18. VBS 第二階段以 cmd /c call 分開引號啟動 phase2', function () {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  );
  const vbs = fs.readFileSync(
    path.join(root, 'scripts', 'data-sync', 'run-gui-launcher.vbs'),
    'utf8'
  );
  assert.match(
    vbs,
    /cmd \/c call " & Q\(phase2Bat\) & " " & Q\(mode\) & " " & Q\(resultFile\)/
  );
});

test('19. run-gui-phase2.bat 成功自動關閉、失敗保留 pause', function () {
  if (process.platform !== 'win32') {
    return;
  }
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  );
  const bat = fs.readFileSync(
    path.join(root, 'scripts', 'data-sync', 'run-gui-phase2.bat')
  );
  const text = bat.toString('ascii');
  assert.match(text, /timeout \/t 5 \/nobreak >nul/);
  assert.match(text, /if "%PHASE2_EXIT%"=="0"/);
  assert.match(text, /pause/);
  assert.doesNotMatch(text, /\r\npause\r\nendlocal/);
});
