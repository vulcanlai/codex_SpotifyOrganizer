/**
 * PKCE（Proof Key for Code Exchange）與 OAuth state 產生
 * 使用 Node.js crypto，符合 RFC 7636
 */
import crypto from 'node:crypto';

/**
 * 產生 code_verifier：43–128 字元的 URL-safe 隨機字串
 */
export function create_code_verifier() {
  return base64_url_encode(crypto.randomBytes(32));
}

/**
 * code_challenge = BASE64URL(SHA256(code_verifier))
 * @param {string} code_verifier
 */
export function create_code_challenge(code_verifier) {
  const hash = crypto.createHash('sha256').update(code_verifier).digest();
  return base64_url_encode(hash);
}

/**
 * 防 CSRF 的隨機 state
 */
export function create_state() {
  return base64_url_encode(crypto.randomBytes(16));
}

/**
 * 將 Buffer 或字串轉為 Base64 URL 編碼（無 padding）
 * @param {Buffer|string} input
 */
function base64_url_encode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
