/** 正式呼叫端的身分核准來源；不讀取專案 .env 或程序繼承的核准 SID。 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const USER_SID = /^S-1-5-21-(?:\d+-){3}\d+$/;
const messages = {
  authorization_required: '尚未設定核准的 Windows 使用者 SID；請由本人在一般使用者環境另行完成核准設定。',
  invalid_authorization: 'Windows 使用者核准設定格式無效；已停止 Token 存取。',
  identity_mismatch: '執行帳號與核准使用者不符；請由核准的 Windows 一般使用者執行。',
  sandbox_identity: 'Codex 沙箱不得存取正式 Token；請在沙箱外以核准的一般使用者執行。',
  elevated_identity: '請使用未提升權限的 Windows 一般使用者終端機執行。',
  identity_check_failed: '無法可靠確認 Windows 執行身分；已停止 Token 存取。',
  execution_failed: '無法執行 Windows 身分檢查工具；已停止 Token 存取。',
  exit_nonzero: 'Windows 身分檢查工具執行失敗；已停止 Token 存取。',
  policy_parse_failed: '無法解析 Windows 身分核准結果；已停止 Token 存取。',
  unsafe_acl: 'Token ACL 不安全或必要授權不完整；請先另行核准權限遷移，不要重新登入或放寬 ACL。',
  owner_mismatch: 'Token 擁有者與核准使用者不符；已停止存取，請先確認遷移方案。',
  access_denied: '作業系統拒絕 Token 存取；這不是未登入，請確認執行身分與權限。',
  invalid_token_file: 'Token 檔案格式無效；已停止，不會自動重新登入或覆寫檔案。',
  file_changed: 'Token 檔案在檢查過程中變動；已停止存取。',
  file_operation_failed: 'Token 檔案存取失敗；請確認磁碟及權限，不會自動重新登入。',
  sid_parse_failed: '無法解析執行帳號 SID；已停止 Token 存取。',
  acl_parse_failed: '無法解析 ACL 檢查結果；已停止 Token 存取。',
  acl_operation_failed: 'ACL 設定失敗；已停止 Token 寫入，請確認復原結果。',
  acl_restore_failed: 'ACL 復原無法確認成功；已停止，請另行檢查隔離檔案權限。',
  not_regular_file: 'Token 路徑不是單一一般檔案；已停止存取。',
  mode_too_open: 'Token 權限過寬；已停止存取，請先完成權限遷移。',
};

export class TokenAccessError extends Error {
  constructor(reason, operation = 'access') {
    const safe = Object.hasOwn(messages, reason) ? reason : 'file_operation_failed';
    super(`[Token] ${messages[safe]}`);
    this.name = 'TokenAccessError';
    this.code = operation === 'save' ? 'TOKEN_SECURE_SAVE_FAILED' : 'TOKEN_ACCESS_FAILED';
    this.reason = safe;
  }
}

export function is_token_access_error(error) {
  return error instanceof TokenAccessError || error?.code === 'TOKEN_SECURE_SAVE_FAILED' || error?.code === 'TOKEN_ACCESS_FAILED';
}

// 只輸出固定狀態及核准 SID；不回傳帳號名稱、其他群組或環境變數。
const policy_script = `
$ErrorActionPreference = 'Stop'
try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if ($identity.Name -match '(?i)\\\\CodexSandbox') {
    @{ok=$false; reason='sandbox_identity'} | ConvertTo-Json -Compress; exit
  }
  try {
    $account = New-Object Security.Principal.NTAccount([Environment]::MachineName, 'CodexSandboxUsers')
    $sandboxSid = $account.Translate([Security.Principal.SecurityIdentifier])
    if (@($identity.Groups | ForEach-Object {$_.Value}) -contains $sandboxSid.Value) {
      @{ok=$false; reason='sandbox_identity'} | ConvertTo-Json -Compress; exit
    }
  } catch [Security.Principal.IdentityNotMappedException] {
    # 未安裝 Codex 沙箱群組的一般 Windows 環境。
  }
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    @{ok=$false; reason='elevated_identity'} | ConvertTo-Json -Compress; exit
  }
  $approved = [Environment]::GetEnvironmentVariable('SPOTIFYORG_AUTHORIZED_WINDOWS_SID', 'User')
  if ([string]::IsNullOrEmpty($approved)) {
    @{ok=$false; reason='authorization_required'} | ConvertTo-Json -Compress; exit
  }
  if ($approved -notmatch '^S-1-5-21-(\\d+-){3}\\d+$') {
    @{ok=$false; reason='invalid_authorization'} | ConvertTo-Json -Compress; exit
  }
  if ($approved -ne $identity.User.Value) {
    @{ok=$false; reason='identity_mismatch'} | ConvertTo-Json -Compress; exit
  }
  @{ok=$true; sid=$approved; current_sid=$identity.User.Value; source='user_registry'; sandbox=$false} | ConvertTo-Json -Compress
} catch {
  @{ok=$false; reason='identity_check_failed'} | ConvertTo-Json -Compress
}
`;

/** 每次操作重新核對，不自動建立核准設定、不快取程序身分。deps 僅供離線測試注入。 */
export function get_runtime_token_protection(deps = {}) {
  if ((deps.platform || process.platform) !== 'win32') return {};
  const root = process.env.SystemRoot || 'C:\\Windows';
  if (!path.win32.isAbsolute(root)) throw new TokenAccessError('execution_failed');
  const command = path.win32.join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  let result;
  try {
    result = (deps.spawnSync || spawnSync)(command,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(policy_script, 'utf16le').toString('base64')],
      { shell: false, windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
  } catch { throw new TokenAccessError('execution_failed'); }
  if (!result || result.error || result.status == null) throw new TokenAccessError('execution_failed');
  if (result.status !== 0) throw new TokenAccessError('exit_nonzero');
  let data;
  try { data = JSON.parse(String(result.stdout || '').replace(/^\uFEFF/, '')); }
  catch { throw new TokenAccessError('policy_parse_failed'); }
  if (data?.ok !== true) {
    const allowed = ['sandbox_identity', 'elevated_identity', 'authorization_required',
      'invalid_authorization', 'identity_mismatch', 'identity_check_failed'];
    throw new TokenAccessError(allowed.includes(data?.reason) ? data.reason : 'identity_check_failed');
  }
  if (!USER_SID.test(data.sid) || data.sid !== data.current_sid || data.sandbox !== false || data.source !== 'user_registry') {
    throw new TokenAccessError('policy_parse_failed');
  }
  return { authorized_windows_user_sid: data.sid };
}
