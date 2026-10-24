/**
 * Token 檔案本機權限（M4）
 * Windows：icacls 限制繼承與使用者 ACL；其他平台：chmod 600
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * @typedef {Object} TokenFileProtectionResult
 * @property {boolean} ok
 * @property {string} platform
 * @property {string} [method]
 * @property {string} [warning]
 * @property {string} [manual_hint_zh]
 * @property {boolean} [partial_acl_applied]
 * @property {boolean} [recovery_attempted]
 */

/**
 * @typedef {Object} TokenFileProtectionDeps
 * @property {string} [platform]
 * @property {typeof spawnSync} [spawnSync]
 * @property {() => { username: string }} [userInfo]
 * @property {() => string|null} [resolve_windows_user_sid]
 * @property {string} [expected_windows_user_sid] - 僅 verify 用（測試／對照）
 */

const WIN_BROAD_PRINCIPAL = [
  'EVERYONE',
  'BUILTIN\\USERS',
  'BUILTIN\\GUESTS',
  'NT AUTHORITY\\AUTHENTICATED USERS',
  'NT AUTHORITY\\INTERACTIVE',
  'GUEST',
];

const WIN_ALLOWED_SYSTEM = [
  'NT AUTHORITY\\SYSTEM',
  'BUILTIN\\ADMINISTRATORS',
  'CREATOR OWNER',
  'NT SERVICE\\TRUSTEDINSTALLER',
];

/**
 * @param {string} file_path
 */
export function get_token_file_manual_acl_instructions_zh(file_path) {
  const resolved = path.resolve(file_path);
  if (process.platform === 'win32') {
    return (
      '若自動設定失敗，請在命令提示字元執行（路徑請改為您的專案）：\n' +
      `  whoami /user\n` +
      `  icacls "${resolved}" /inheritance:r\n` +
      `  icacls "${resolved}" /grant:r "*<您的SID>:(M)"\n` +
      `  icacls "${resolved}" /grant "SYSTEM:(F)"\n` +
      '並確認未保留 Everyone、Users 或其他非必要帳號的存取。'
    );
  }
  return `可手動執行：chmod 600 "${resolved}"`;
}

/**
 * @param {typeof spawnSync} spawn_sync_fn
 * @returns {string|null}
 */
export function resolve_windows_current_user_sid(spawn_sync_fn) {
  const result = spawn_sync_fn('whoami', ['/user'], {
    windowsHide: true,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    return null;
  }
  const match = String(result.stdout || '').match(/(S-1-5-[0-9-]+)/);
  return match ? match[1] : null;
}

/**
 * @param {string} file_path
 * @param {TokenFileProtectionDeps} [deps]
 * @returns {TokenFileProtectionResult}
 */
export function apply_token_file_protection(file_path, deps) {
  const d = deps || {};
  const platform = d.platform || process.platform;
  const resolved = path.resolve(file_path);

  if (!fs.existsSync(resolved)) {
    return {
      ok: false,
      platform,
      warning: '檔案不存在，略過權限設定。',
    };
  }

  if (platform === 'win32') {
    return apply_windows_acl(resolved, d.spawnSync || spawnSync, d);
  }

  try {
    fs.chmodSync(resolved, 0o600);
    return { ok: true, platform, method: 'chmod600' };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return {
      ok: false,
      platform,
      warning: `chmod 600 失敗：${msg}`,
      manual_hint_zh: get_token_file_manual_acl_instructions_zh(resolved),
    };
  }
}

/**
 * @param {string} resolved_path
 * @param {typeof spawnSync} spawn_sync_fn
 * @param {TokenFileProtectionDeps} d
 * @returns {TokenFileProtectionResult}
 */
function apply_windows_acl(resolved_path, spawn_sync_fn, d) {
  const resolve_sid =
    d.resolve_windows_user_sid ||
    function () {
      return resolve_windows_current_user_sid(spawn_sync_fn);
    };

  const sid = resolve_sid();
  if (!sid) {
    return {
      ok: false,
      platform: 'win32',
      warning:
        '無法解析目前使用者 SID，未修改 ACL（無法確認 token 檔案已受保護）。',
      manual_hint_zh: get_token_file_manual_acl_instructions_zh(resolved_path),
    };
  }

  const sid_grant = `*${sid}:(M)`;

  /** @type {Array<[string, string[]]>} */
  const steps = [
    ['icacls', [resolved_path, '/inheritance:r']],
    ['icacls', [resolved_path, '/grant:r', sid_grant]],
    ['icacls', [resolved_path, '/grant', 'SYSTEM:(F)']],
    ['icacls', [resolved_path, '/grant', 'BUILTIN\\Administrators:(F)']],
  ];

  let inheritance_removed = false;

  for (let i = 0; i < steps.length; i += 1) {
    const cmd = steps[i][0];
    const args = steps[i][1];
    const result = spawn_sync_fn(cmd, args, {
      windowsHide: true,
      encoding: 'utf8',
      shell: false,
    });
    if (i === 0 && result.status === 0) {
      inheritance_removed = true;
    }
    if (result.status !== 0) {
      const stderr = sanitize_icacls_output(result.stderr || result.stdout || '');
      let recovery_attempted = false;
      if (inheritance_removed) {
        recovery_attempted = attempt_windows_acl_inheritance_recovery(
          resolved_path,
          spawn_sync_fn
        );
      }
      return {
        ok: false,
        platform: 'win32',
        method: 'icacls',
        partial_acl_applied: inheritance_removed,
        recovery_attempted,
        warning:
          `icacls 步驟 ${i + 1} 失敗（exit ${result.status}）` +
          (stderr ? '：' + stderr : '') +
          '；無法確認 token 檔案 ACL 已受保護。',
        manual_hint_zh: get_token_file_manual_acl_instructions_zh(resolved_path),
      };
    }
  }

  const verified = verify_token_file_protection(resolved_path, {
    platform: 'win32',
    spawnSync: spawn_sync_fn,
    expected_windows_user_sid: sid,
  });
  if (!verified.ok) {
    return {
      ok: false,
      platform: 'win32',
      method: 'icacls',
      warning:
        'icacls 步驟已完成，但事後檢查無法確認 ACL 安全（' +
        (verified.reason || 'unknown') +
        '）。',
      manual_hint_zh: get_token_file_manual_acl_instructions_zh(resolved_path),
    };
  }

  return { ok: true, platform: 'win32', method: 'icacls' };
}

/**
 * @param {string} resolved_path
 * @param {typeof spawnSync} spawn_sync_fn
 */
function attempt_windows_acl_inheritance_recovery(resolved_path, spawn_sync_fn) {
  const result = spawn_sync_fn(
    'icacls',
    [resolved_path, '/inheritance:e'],
    {
      windowsHide: true,
      encoding: 'utf8',
      shell: false,
    }
  );
  return result.status === 0;
}

/**
 * @param {string} text
 */
function sanitize_icacls_output(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > 120 ? t.slice(0, 120) + '…' : t;
}

/**
 * 從 icacls 輸出擷取 `主體:(權限)`（略過檔名中的磁碟代號）
 * @param {string} output
 */
function extract_icacls_aces(output) {
  const aces = [];
  const re =
    /(\*S-1-5-[0-9-]+|[A-Za-z0-9._ @-]+\\[^\s:(]+):\(([A-Z,()]+)\)/gi;
  let m;
  const text = String(output || '');
  while ((m = re.exec(text)) !== null) {
    aces.push({ principal: m[1].trim(), perms: m[2].toUpperCase() });
  }
  return aces;
}

function normalize_principal(p) {
  return String(p || '').trim().toUpperCase();
}

function principal_is_broad(principal_upper) {
  for (let i = 0; i < WIN_BROAD_PRINCIPAL.length; i += 1) {
    if (principal_upper === WIN_BROAD_PRINCIPAL[i]) {
      return true;
    }
  }
  return false;
}

/**
 * icacls 文字中常見寬鬆主體（含無反斜線的 Everyone）
 * @param {string} output
 */
function raw_icacls_output_has_broad_acl(output) {
  const upper = String(output || '').toUpperCase();
  for (let i = 0; i < WIN_BROAD_PRINCIPAL.length; i += 1) {
    const token = WIN_BROAD_PRINCIPAL[i];
    if (upper.indexOf(token + ':') >= 0 || upper.indexOf(token + '(') >= 0) {
      return true;
    }
  }
  return false;
}

function principal_is_allowed_system(principal_upper) {
  for (let i = 0; i < WIN_ALLOWED_SYSTEM.length; i += 1) {
    if (principal_upper === WIN_ALLOWED_SYSTEM[i]) {
      return true;
    }
  }
  return false;
}

function sid_matches_principal(principal_upper, sid_upper) {
  if (!sid_upper) {
    return false;
  }
  return (
    principal_upper === sid_upper ||
    principal_upper.indexOf(sid_upper) >= 0
  );
}

function perms_allow_access(perms) {
  const p = perms.toUpperCase();
  return (
    p.indexOf('F') >= 0 ||
    p.indexOf('M') >= 0 ||
    p.indexOf('W') >= 0 ||
    p.indexOf('R') >= 0
  );
}

/**
 * 唯讀檢查（不修改 ACL）；無法肯定時 ok 為 false
 * @param {string} file_path
 * @param {TokenFileProtectionDeps} [deps]
 */
export function verify_token_file_protection(file_path, deps) {
  const d = deps || {};
  const platform = d.platform || process.platform;
  const resolved = path.resolve(file_path);

  if (!fs.existsSync(resolved)) {
    return { ok: false, platform, reason: 'missing_file' };
  }

  if (platform === 'win32') {
    const spawn_sync_fn = d.spawnSync || spawnSync;
    const result = spawn_sync_fn('icacls', [resolved], {
      windowsHide: true,
      encoding: 'utf8',
      shell: false,
    });
    const out = String(result.stdout || '') + String(result.stderr || '');
    if (result.status !== 0) {
      return { ok: false, platform, reason: 'icacls_read_failed' };
    }

    if (raw_icacls_output_has_broad_acl(out)) {
      return { ok: false, platform, reason: 'overly_broad_acl' };
    }

    const expected_sid =
      d.expected_windows_user_sid ||
      (d.resolve_windows_user_sid
        ? d.resolve_windows_user_sid()
        : resolve_windows_current_user_sid(spawn_sync_fn));

    if (!expected_sid) {
      return { ok: false, platform, reason: 'cannot_confirm_safe' };
    }
    const sid_upper = expected_sid.toUpperCase();

    const aces = extract_icacls_aces(out);
    if (aces.length === 0) {
      return { ok: false, platform, reason: 'cannot_confirm_safe' };
    }

    let user_allowed = false;
    for (let i = 0; i < aces.length; i += 1) {
      const principal_upper = normalize_principal(aces[i].principal);
      if (
        sid_matches_principal(principal_upper, sid_upper) &&
        perms_allow_access(aces[i].perms)
      ) {
        user_allowed = true;
        continue;
      }
      if (principal_is_allowed_system(principal_upper)) {
        continue;
      }
      if (perms_allow_access(aces[i].perms)) {
        return {
          ok: false,
          platform,
          reason: 'unrecognized_ace',
          detail: principal_upper,
        };
      }
    }

    if (!user_allowed) {
      return { ok: false, platform, reason: 'cannot_confirm_safe' };
    }

    return { ok: true, platform, method: 'icacls_inspect' };
  }

  try {
    const mode = fs.statSync(resolved).mode & 0o777;
    if (mode === 0o600 || mode === 0o400) {
      return { ok: true, platform, method: 'mode_bits', mode_octal: mode.toString(8) };
    }
    return { ok: false, platform, reason: 'mode_too_open', mode_octal: mode.toString(8) };
  } catch {
    return { ok: false, platform, reason: 'stat_failed' };
  }
}
