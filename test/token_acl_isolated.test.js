import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  apply_token_file_protection, verify_token_file_protection,
  resolve_windows_current_user_sid_result,
} from '../lib/auth/token_file_permissions.js';
import { save_tokens_to_path } from '../lib/token_store.js';

const USER = 'S-1-5-21-111-222-333-1001';
const SANDBOX = 'S-1-5-21-111-222-333-1004';
const fake = { access_token: 'FAKE_ACCESS_ONLY', refresh_token: 'FAKE_REFRESH_ONLY' };
function scratch(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-acl-isolated-'));
  const file = path.join(dir, '假 token [test].json');
  try { return fn(file); }
  finally {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('so-acl-isolated-'));
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(fs.existsSync(dir), false);
  }
}
function mock({ current = USER, reply = { ok: true }, whoami } = {}) {
  const calls = [];
  return {
    platform: 'win32', authorized_windows_user_sid: USER, calls,
    spawnSync(command, args, opts) {
      calls.push({ command, args, opts });
      assert.equal(path.win32.isAbsolute(command), true);
      assert.equal(opts.shell, false);
      if (command.endsWith('whoami.exe')) return whoami || { status: 0, stdout: `"帳號","${current}"\r\n` };
      assert.ok(command.endsWith('WindowsPowerShell\\v1.0\\powershell.exe'));
      assert.ok(args.includes('-NoProfile'));
      const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      const action = script.match(/\} '(create|apply|verify)' '((?:[^']|'')*)' /);
      args.push(action?.[1]);
      if (action?.[1] === 'create' && reply.ok === true) fs.writeFileSync(action[2].replaceAll("''", "'"), '', { flag: 'wx' });
      return { status: 0, stdout: JSON.stringify(reply) };
    },
  };
}

test('SID：語系不影響第二欄；固定路徑、無 shell，區分三種失敗且不洩漏輸出', () => {
  for (const account of ['主機\\使用者', 'HOST\\User', '�亂碼']) {
    const d = mock({ whoami: { status: 0, stdout: `"${account}","${USER}"\r\n` } });
    assert.deepEqual(resolve_windows_current_user_sid_result(d.spawnSync), { ok: true, sid: USER });
  }
  for (const [r, reason] of [
    [{ status: null, error: new Error('SECRET') }, 'execution_failed'],
    [{ status: 9, stdout: 'SECRET', stderr: 'SECRET' }, 'exit_nonzero'],
    [{ status: 0, stdout: 'SECRET' }, 'sid_parse_failed'],
  ]) {
    const result = resolve_windows_current_user_sid_result(() => r);
    assert.equal(result.reason, reason);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
  }
  assert.equal(resolve_windows_current_user_sid_result(() => { throw new Error('SECRET'); }).reason, 'execution_failed');
});

test('本人與沙箱 SID 不同時停止；未核准或群組 SID 不執行 ACL', () => scratch(file => {
  fs.writeFileSync(file, 'fake-old');
  for (const d of [mock({ current: SANDBOX }), { ...mock(), authorized_windows_user_sid: undefined },
    { ...mock(), authorized_windows_user_sid: 'S-1-5-32-545' }]) {
    assert.equal(apply_token_file_protection(file, d).ok, false);
    assert.equal(d.calls.some(c => c.command.endsWith('powershell.exe')), false);
  }
}));

test('一般使用者假 Token 建立與更新：先安全建立空檔，寫入前再次確認 ACL', () => scratch(file => {
  const d = mock();
  const tokens = { toJSON() {
    assert.ok(d.calls.some(c => c.args.includes('create')));
    assert.equal(fs.readFileSync(file, 'utf8'), '');
    return fake;
  } };
  save_tokens_to_path(file, tokens, d);
  assert.ok(d.calls.some(c => c.args.includes('verify')));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), fake);
  d.calls.length = 0;
  save_tokens_to_path(file, { ...fake, access_token: 'UPDATED_FAKE' }, d);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).access_token, 'UPDATED_FAKE');
  assert.equal(d.calls.some(c => c.args.includes('apply')), false);
}));

test('SID 失敗、新 ACL 失敗與既有不安全 ACL 均不寫入假 Token', () => scratch(file => {
  const sidFailure = mock({ whoami: { status: 0, stdout: 'unparseable' } });
  assert.throws(() => save_tokens_to_path(file, fake, sidFailure), { code: 'TOKEN_SECURE_SAVE_FAILED' });
  assert.equal(fs.existsSync(file), false);
  const fail = mock({ reply: { ok: false, reason: 'acl_operation_failed', recovery_attempted: true, recovery_succeeded: true } });
  assert.throws(() => save_tokens_to_path(file, fake, fail), { code: 'TOKEN_SECURE_SAVE_FAILED' });
  assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, 'FAKE_OLD_CONTENT');
  const unsafe = mock({ reply: { ok: false, reason: 'unsafe_acl' } });
  assert.throws(() => save_tokens_to_path(file, fake, unsafe), { code: 'TOKEN_SECURE_SAVE_FAILED' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'FAKE_OLD_CONTENT');
  assert.equal(unsafe.calls.some(c => c.args.includes('apply')), false);
}));

test('ACL 失敗與復原結果使用固定分類，不轉送敏感輸出', () => scratch(file => {
  fs.writeFileSync(file, 'fake');
  for (const restored of [true, false]) {
    const reason = restored ? 'acl_operation_failed' : 'acl_restore_failed';
    const d = mock({ reply: { ok: false, reason, recovery_attempted: true, recovery_succeeded: restored, detail: fake } });
    const result = apply_token_file_protection(file, d);
    assert.equal(result.reason, reason);
    assert.equal(result.recovery_attempted, true);
    assert.equal(result.recovery_succeeded, restored);
    assert.ok(!JSON.stringify(result).includes(fake.access_token));
  }
  assert.equal(verify_token_file_protection(file, mock({ reply: { ok: false, reason: 'owner_mismatch' } })).reason, 'owner_mismatch');
}));

const native = process.platform === 'win32';
const helper = fileURLToPath(new URL('../lib/auth/token_file_acl.ps1', import.meta.url));
const ps = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
function powershell(script) {
  const r = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', shell: false });
  assert.equal(r.status, 0, 'isolated PowerShell failed: ' + r.stderr);
  return r.stdout.trim();
}

test('Windows 真實隔離 ACL：明確核准沙箱單一 SID、保留 SYSTEM/Administrators，更新不變更 ACL', { skip: !native }, () => scratch(file => {
  const current = resolve_windows_current_user_sid_result();
  assert.equal(current.ok, true);
  const d = { authorized_windows_user_sid: current.sid };
  save_tokens_to_path(file, fake, d);
  assert.equal(verify_token_file_protection(file, d).ok, true);
  const inspect = () => JSON.parse(powershell(`$a=Get-Acl -LiteralPath ${quote(file)}; @{sddl=$a.Sddl; protected=$a.AreAccessRulesProtected; sids=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object {$_.IdentityReference.Value})} | ConvertTo-Json -Compress`));
  const before = inspect();
  assert.equal(before.protected, true);
  assert.deepEqual(before.sids.sort(), [current.sid, 'S-1-5-18', 'S-1-5-32-544'].sort());
  save_tokens_to_path(file, { ...fake, access_token: 'UPDATED_FAKE' }, d);
  assert.equal(inspect().sddl, before.sddl);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).access_token, 'UPDATED_FAKE');
}));

test('Windows 原生 DACL 套用後模擬失敗：恢復原始 DACL，空檔仍可讀寫', { skip: !native }, () => scratch(file => {
  fs.writeFileSync(file, '');
  const current = resolve_windows_current_user_sid_result();
  const original = powershell(`(Get-Acl -LiteralPath ${quote(file)}).Sddl`);
  const result = JSON.parse(powershell(`
    $script:count=0
    function Get-Acl { param($LiteralPath)
      $script:count++
      if ($script:count -eq 2) { throw 'injected post-apply verification failure' }
      Microsoft.PowerShell.Security\\Get-Acl -LiteralPath $LiteralPath
    }
    & { ${fs.readFileSync(helper, 'utf8')} } apply ${quote(file)} ${quote(current.sid)}
  `));
  assert.equal(result.ok, false);
  assert.equal(result.recovery_attempted, true);
  assert.equal(result.recovery_succeeded, true);
  assert.equal(powershell(`(Get-Acl -LiteralPath ${quote(file)}).Sddl`), original);
  fs.writeFileSync(file, 'FAKE_AFTER_RECOVERY');
  assert.equal(fs.readFileSync(file, 'utf8'), 'FAKE_AFTER_RECOVERY');
}));

test('Windows 原生驗證拒絕額外 SID、繼承、唯讀本人與缺少 SYSTEM', { skip: !native }, () => scratch(file => {
  fs.writeFileSync(file, '');
  const current = resolve_windows_current_user_sid_result();
  const d = { authorized_windows_user_sid: current.sid };
  for (const change of [
    "$a.SetAccessRuleProtection($false,$true)",
    "$b=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-11'); $a.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($b,'Read','Allow')))",
    "$a.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($u,'Read','Allow')))",
    "$a.PurgeAccessRules((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')))",
    "$a.PurgeAccessRules((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')))",
  ]) {
    assert.equal(apply_token_file_protection(file, d).ok, true);
    powershell(`$u=New-Object System.Security.Principal.SecurityIdentifier(${quote(current.sid)}); $a=[IO.File]::GetAccessControl(${quote(file)},[Security.AccessControl.AccessControlSections]::Access); ${change}; [IO.File]::SetAccessControl(${quote(file)},$a)`);
    assert.equal(verify_token_file_protection(file, d).ok, false);
  }
}));

test('Windows 原生命令環境：PowerShell 啟動 Node 的 SID 與直接查詢一致', { skip: !native }, () => scratch(file => {
  const probe = path.join(path.dirname(file), 'probe.cjs');
  const module = pathToFileURL(fileURLToPath(new URL('../lib/auth/token_file_permissions.js', import.meta.url))).href;
  fs.writeFileSync(probe, `import(${JSON.stringify(module)}).then(m=>console.log(JSON.stringify(m.resolve_windows_current_user_sid_result())))`);
  const current = resolve_windows_current_user_sid_result();
  assert.deepEqual(JSON.parse(powershell(`& ${quote(process.execPath)} ${quote(probe)}`)), current);
}));

const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
test('Git Bash 啟動 Windows Node：SID 與原生查詢一致、無 MSYS 參數轉換', {
  skip: !native || !fs.existsSync(gitBash),
}, () => scratch(file => {
  const probe = path.join(path.dirname(file), 'probe.cjs');
  const module = pathToFileURL(fileURLToPath(new URL('../lib/auth/token_file_permissions.js', import.meta.url))).href;
  fs.writeFileSync(probe, `import(${JSON.stringify(module)}).then(m=>console.log(JSON.stringify(m.resolve_windows_current_user_sid_result())))`);
  const r = spawnSync(gitBash, ['--noprofile', '--norc', '-c', 'exec "$1" "$2"', 'acl-probe', process.execPath, probe], {
    encoding: 'utf8', shell: false, timeout: 15000,
  });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout.trim()), resolve_windows_current_user_sid_result());
}));
