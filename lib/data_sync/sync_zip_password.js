/**
 * 從專案 .env 讀取 DATA_SYNC_ZIP_PASSWORD（不寫入 process.env）
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ENV_DATA_SYNC_ZIP_PASSWORD,
  ENV_ALLOW_7Z_PASSWORD_STDIN,
} from './constants.js';
import { ACCEPTANCE_SANDBOX_DIR_PREFIX } from './acceptance_sandbox.js';

/** @type {RegExp[]} */
export const SYNC_ZIP_PASSWORD_REDACT = [
  new RegExp(ENV_DATA_SYNC_ZIP_PASSWORD + '\\s*=\\s*\\S+', 'gi'),
  /(-p)\S+/gi,
  /password\s*[:=]\s*\S+/gi,
];

/**
 * @param {string | null | undefined} text
 * @param {string | null | undefined} [secret]
 * @param {number} [max_len]
 */
export function redact_sync_zip_secrets(text, secret, max_len) {
  const limit = max_len != null ? max_len : 400;
  if (!text || typeof text !== 'string') {
    return '';
  }
  let out = text.replace(/\r/g, '\n');
  for (let i = 0; i < SYNC_ZIP_PASSWORD_REDACT.length; i += 1) {
    out = out.replace(SYNC_ZIP_PASSWORD_REDACT[i], '$1[已省略]');
  }
  if (secret && secret.length > 0) {
    out = out.split(secret).join('[REDACTED]');
  }
  out = out.trim();
  if (out.length > limit) {
    out = out.slice(0, limit) + '…';
  }
  return out;
}

/**
 * @param {string} env_file_abs
 */
export function read_data_sync_zip_password_from_env_file(env_file_abs) {
  if (!env_file_abs || !fs.existsSync(env_file_abs)) {
    return {
      ok: false,
      reason_zh:
        '缺少專案根目錄 .env，請建立並設定 ' + ENV_DATA_SYNC_ZIP_PASSWORD,
    };
  }
  const lines = fs.readFileSync(env_file_abs, 'utf8').split(/\r?\n/);
  /** @type {string | null} */
  let value = null;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.charAt(0) === '#') {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (key !== ENV_DATA_SYNC_ZIP_PASSWORD) {
      continue;
    }
    let raw = trimmed.slice(eq + 1).trim();
    if (
      (raw.charAt(0) === '"' && raw.charAt(raw.length - 1) === '"') ||
      (raw.charAt(0) === "'" && raw.charAt(raw.length - 1) === "'")
    ) {
      raw = raw.slice(1, -1);
    }
    value = raw;
    break;
  }
  if (value === null || value === '') {
    return {
      ok: false,
      reason_zh:
        ENV_DATA_SYNC_ZIP_PASSWORD +
        ' 未設定或為空白，請在本機 .env 設定資料同步 ZIP 密碼（勿提交版控）',
    };
  }
  return { ok: true, password: value };
}

/**
 * @param {string} root
 */
export function is_acceptance_sandbox_project_root(root) {
  if (!root || typeof root !== 'string') {
    return false;
  }
  const base = path.basename(path.resolve(root));
  return base.indexOf(ACCEPTANCE_SANDBOX_DIR_PREFIX) === 0;
}

/**
 * @param {string} project_root 匯入／匯出操作中的專案根（可為沙箱）
 * @param {'env' | 'stdin'} password_mode
 * @param {string | null | undefined} stdin_password
 * @param {string | null | undefined} [sync_env_project_root] 僅讀取 .env 的來源專案根（正式 SpotifyOrganizer）
 */
export function resolve_sync_zip_password(
  project_root,
  password_mode,
  stdin_password,
  sync_env_project_root
) {
  if (password_mode === 'env') {
    const env_root =
      sync_env_project_root != null && String(sync_env_project_root).trim()
        ? path.resolve(sync_env_project_root)
        : project_root;
    if (is_acceptance_sandbox_project_root(env_root)) {
      return {
        ok: false,
        reason_zh:
          '不得從沙箱 TEMP 目錄讀取 ZIP 密碼；請在 SpotifyOrganizer 專案根目錄 .env 設定 ' +
          ENV_DATA_SYNC_ZIP_PASSWORD,
      };
    }
    const env_path = path.join(env_root, '.env');
    return read_data_sync_zip_password_from_env_file(env_path);
  }
  if (password_mode === 'stdin') {
    if (process.env[ENV_ALLOW_7Z_PASSWORD_STDIN] !== '1') {
      return {
        ok: false,
        reason_zh:
          '測試模式拒絕 stdin 密碼：未啟用 ' + ENV_ALLOW_7Z_PASSWORD_STDIN,
      };
    }
    if (!stdin_password) {
      return { ok: false, reason_zh: '測試模式缺少 stdin_password' };
    }
    return { ok: true, password: stdin_password };
  }
  return {
    ok: false,
    reason_zh:
      '不支援的 password_mode：' +
      password_mode +
      '（正式請使用 env，從 .env 讀取 ' +
      ENV_DATA_SYNC_ZIP_PASSWORD +
      '）',
  };
}
