/** Windows ACL 必須指定核准的使用者 SID，不從沙箱推定本人身分。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * @typedef {Object} TokenFileProtectionDeps
 * @property {string} [platform]
 * @property {typeof spawnSync} [spawnSync]
 * @property {string} [authorized_windows_user_sid] 明確核准的單一使用者 SID。
 */
const USER_SID = /^S-1-5-21-(?:\d+-){3}\d+$/;
const options = { windowsHide: true, encoding: 'utf8', shell: false, timeout: 15000, maxBuffer: 1024 * 1024 };
const helper = fileURLToPath(new URL('./token_file_acl.ps1', import.meta.url));

function system_tool(relative) {
  const root = process.env.SystemRoot || 'C:\\Windows';
  if (!path.win32.isAbsolute(root)) throw new Error('invalid_system_root');
  return path.win32.join(root, 'System32', relative);
}

// 不轉送子程序原始輸出、例外訊息或環境變數。
function run(spawn, command, args) {
  let r;
  try { r = spawn(command, args, options); }
  catch { return { ok: false, reason: 'execution_failed' }; }
  if (!r || r.error || r.status == null) return { ok: false, reason: 'execution_failed' };
  if (r.status !== 0) return { ok: false, reason: 'exit_nonzero', exit_code: Number.isInteger(r.status) ? r.status : null };
  return { ok: true, stdout: String(r.stdout || '') };
}

export function resolve_windows_current_user_sid_result(spawn = spawnSync) {
  let command;
  try { command = system_tool('whoami.exe'); }
  catch { return { ok: false, reason: 'execution_failed' }; }
  const r = run(spawn, command, ['/user', '/fo', 'csv', '/nh']);
  if (!r.ok) return r;
  const match = r.stdout.trim().match(/^"[^"\r\n]*","(S-1-5-21-(?:\d+-){3}\d+)"$/);
  return match ? { ok: true, sid: match[1] } : { ok: false, reason: 'sid_parse_failed' };
}

export function resolve_windows_current_user_sid(spawn = spawnSync) {
  const result = resolve_windows_current_user_sid_result(spawn);
  return result.ok ? result.sid : null;
}

export function get_token_file_manual_acl_instructions_zh() {
  return '請先確認本人 SID、執行帳號與沙箱需求，再另行核准 Token ACL 遷移；勿直接移除繼承。';
}

function failure(platform, reason, extra = {}) {
  return { ok: false, platform, reason, warning: `Token 權限檢查失敗（${reason}），停止寫入。`, ...extra };
}

function identity(d) {
  if (!USER_SID.test(d.authorized_windows_user_sid || '')) return { ok: false, reason: 'authorization_required' };
  const r = resolve_windows_current_user_sid_result(d.spawnSync || spawnSync);
  if (!r.ok) return r;
  if (r.sid !== d.authorized_windows_user_sid) return { ok: false, reason: 'identity_mismatch' };
  return r;
}

function windows_acl(action, file, d) {
  const user = identity(d);
  if (!user.ok) return failure('win32', user.reason, { exit_code: user.exit_code });
  let command;
  try { command = system_tool('WindowsPowerShell\\v1.0\\powershell.exe'); }
  catch { return failure('win32', 'execution_failed'); }
  // 以 inline command 使用 Windows 內建 .NET ACL API；不變更 ExecutionPolicy。
  // 參數使用 PowerShell 單引號 literal，避免路徑成為程式碼。
  const literal = value => "'" + value.replaceAll("'", "''") + "'";
  const script = `& {\n${fs.readFileSync(helper, 'utf8')}\n} ${literal(action)} ${literal(file)} ${literal(user.sid)}`;
  const result = run(d.spawnSync || spawnSync, command,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
  if (!result.ok) return failure('win32', result.reason, { exit_code: result.exit_code });
  let data;
  try { data = JSON.parse(result.stdout.replace(/^\uFEFF/, '')); }
  catch { return failure('win32', 'acl_parse_failed'); }
  if (!data || data.ok !== true) {
    const reasons = ['unsafe_acl', 'owner_mismatch', 'identity_mismatch', 'not_regular_file',
      'acl_operation_failed', 'acl_restore_failed'];
    return failure('win32', reasons.includes(data?.reason) ? data.reason : 'acl_operation_failed', {
      recovery_attempted: data?.recovery_attempted === true,
      recovery_succeeded: data?.recovery_succeeded === true,
    });
  }
  return { ok: true, platform: 'win32', method: 'sid_dacl' };
}

export function apply_token_file_protection(file_path, deps = {}) {
  const platform = deps.platform || process.platform;
  const file = path.resolve(file_path);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return failure(platform, 'not_regular_file');
    if (platform === 'win32') return windows_acl('apply', file, deps);
    fs.chmodSync(file, 0o600);
    return verify_token_file_protection(file, deps);
  } catch { return failure(platform, 'file_operation_failed'); }
}

/** Windows 建立時即帶入 DACL，避免先繼承寬鬆權限而被其他程序預先開啟。 */
export function create_protected_token_file(file_path, deps = {}) {
  const platform = deps.platform || process.platform;
  try {
    if (platform === 'win32') return windows_acl('create', path.resolve(file_path), deps);
    const fd = fs.openSync(file_path, 'wx', 0o600);
    fs.closeSync(fd);
    return verify_token_file_protection(file_path, deps);
  } catch { return failure(platform, 'file_operation_failed'); }
}

/** 唯讀檢查；無法確認安全時一律拒絕。 */
export function verify_token_file_protection(file_path, deps = {}) {
  const platform = deps.platform || process.platform;
  const file = path.resolve(file_path);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return failure(platform, 'not_regular_file');
    if (platform === 'win32') return windows_acl('verify', file, deps);
    if (stat.uid !== process.getuid()) return failure(platform, 'owner_mismatch');
    if ((stat.mode & 0o777) !== 0o600) return failure(platform, 'mode_too_open');
    return { ok: true, platform, method: 'mode_bits' };
  } catch { return failure(platform, 'file_operation_failed'); }
}
