/**
 * 將 access / refresh token 存於本機 JSON 檔（Git 已忽略）
 */
import fs from 'node:fs';
import { TOKEN_FILE } from './config.js';
import { create_protected_token_file, verify_token_file_protection } from './auth/token_file_permissions.js';
import { get_runtime_token_protection, TokenAccessError } from './auth/token_access_policy.js';

/** 提前 60 秒視為過期，避免請求中途失效 */
const EXPIRY_BUFFER_MS = 60 * 1000;

/**
 * @typedef {Object} StoredTokens
 * @property {string} access_token
 * @property {string} [refresh_token]
 * @property {string} token_type
 * @property {number} expires_at - Unix 毫秒時間戳
 * @property {string} [scope]
 */

/**
 * @returns {StoredTokens|null}
 */
export function load_tokens(protection_deps) {
  return load_tokens_from_path(TOKEN_FILE, protection_deps || get_runtime_token_protection());
}

function checked_existing_file(file, protection_deps) {
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new TokenAccessError(['EACCES', 'EPERM'].includes(error.code) ? 'access_denied' : 'file_operation_failed');
  }
  const result = verify_token_file_protection(file, protection_deps);
  if (!result.ok) throw new TokenAccessError(result.reason);
  return stat;
}

/** OAuth／刷新送出請求前先確認身分與既有檔案 ACL，不讀取內容。 */
export function assert_token_storage_ready() {
  const protection = get_runtime_token_protection();
  checked_existing_file(TOKEN_FILE, protection);
  return protection;
}

/** 隔離測試與共用實作；只有檔案不存在才回傳 null。 */
export function load_tokens_from_path(file, protection_deps) {
  const initial = checked_existing_file(file, protection_deps);
  if (!initial) return null;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const held = fs.fstatSync(fd);
    if (held.dev !== initial.dev || held.ino !== initial.ino || held.nlink !== 1) {
      throw new TokenAccessError('file_changed');
    }
    const verified = verify_token_file_protection(file, protection_deps);
    if (!verified.ok) throw new TokenAccessError(verified.reason);
    let data;
    try { data = JSON.parse(fs.readFileSync(fd, 'utf8')); }
    catch (error) {
      if (error instanceof SyntaxError) throw new TokenAccessError('invalid_token_file');
      throw error;
    }
    if (!data || typeof data.access_token !== 'string' || !data.access_token) throw new TokenAccessError('invalid_token_file');
    return data;
  } catch (error) {
    if (error instanceof TokenAccessError) throw error;
    throw new TokenAccessError(['EACCES', 'EPERM'].includes(error.code) ? 'access_denied' : 'file_operation_failed');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * @param {StoredTokens} tokens
 * @param {import('./auth/token_file_permissions.js').TokenFileProtectionDeps} [protection_deps]
 */
export function save_tokens(tokens, protection_deps) {
  save_tokens_to_path(TOKEN_FILE, tokens, protection_deps || get_runtime_token_protection());
}

/**
 * @param {string} file_path
 * @param {StoredTokens} tokens
 * @param {import('./auth/token_file_permissions.js').TokenFileProtectionDeps} [protection_deps]
 */
export function save_tokens_to_path(file_path, tokens, protection_deps) {
  const dir = file_path.replace(/[\\/][^\\/]+$/, '');
  let fd;
  let failure_reason = 'file_operation_failed';
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let exists;
    try { fs.lstatSync(file_path); exists = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
    if (exists) {
      // 更新只做唯讀 ACL 檢查，不自動遷移既有敏感檔案權限。
      const checked = verify_token_file_protection(file_path, protection_deps);
      if (!checked.ok) { failure_reason = checked.reason; throw new Error('unsafe_file'); }
      fd = fs.openSync(file_path, 'r+');
    } else {
      // 建立時即限制權限；失敗最多留下空檔，絕不先寫入 Token。
      const protected_file = create_protected_token_file(file_path, protection_deps);
      if (!protected_file.ok) { failure_reason = protected_file.reason; throw new Error('unsafe_file'); }
      fd = fs.openSync(file_path, 'r+');
    }
    const serialized = JSON.stringify(tokens, null, 2);
    const held = fs.fstatSync(fd);
    const named = fs.lstatSync(file_path);
    if (held.dev !== named.dev || held.ino !== named.ino || held.nlink !== 1) throw new Error('file_changed');
    const verified = verify_token_file_protection(file_path, protection_deps);
    if (!verified.ok) { failure_reason = verified.reason; throw new Error('unsafe_file'); }
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, serialized, 'utf8');
    fs.fsyncSync(fd);
  } catch (cause) {
    // 不回傳可能含 Token、路徑、環境變數或子程序輸出的原始例外。
    if (['EACCES', 'EPERM'].includes(cause.code)) failure_reason = 'access_denied';
    throw new TokenAccessError(failure_reason, 'save');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * @param {StoredTokens|null} tokens
 */
export function is_access_token_valid(tokens) {
  if (!tokens || !tokens.access_token || !tokens.expires_at) {
    return false;
  }
  return Date.now() < tokens.expires_at - EXPIRY_BUFFER_MS;
}

/**
 * 將 Spotify token 回應合併進既有 refresh_token（更新時可能不會再回傳 refresh）
 * @param {object} token_response - accounts.spotify.com/api/token JSON
 * @param {StoredTokens|null} previous
 * @returns {StoredTokens}
 */
export function tokens_from_api_response(token_response, previous) {
  const expires_in = Number(token_response.expires_in) || 3600;
  const refresh =
    token_response.refresh_token ||
    (previous && previous.refresh_token) ||
    '';

  return {
    access_token: token_response.access_token,
    refresh_token: refresh,
    token_type: token_response.token_type || 'Bearer',
    expires_at: Date.now() + expires_in * 1000,
    scope: token_response.scope || (previous && previous.scope) || '',
  };
}
