/**
 * 將 access / refresh token 存於本機 JSON 檔（Git 已忽略）
 */
import fs from 'node:fs';
import { TOKEN_FILE } from './config.js';

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
export function load_tokens() {
  if (!fs.existsSync(TOKEN_FILE)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data.access_token !== 'string') {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * @param {StoredTokens} tokens
 */
export function save_tokens(tokens) {
  const dir = TOKEN_FILE.replace(/[\\/][^\\/]+$/, '');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8');
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
