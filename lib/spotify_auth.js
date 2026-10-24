/**
 * Spotify Authorization Code + PKCE（無 Client Secret）
 */
import {
  SPOTIFY_AUTH_URL,
  SPOTIFY_TOKEN_URL,
  REDIRECT_URI,
  SCOPES,
  get_client_id,
} from './config.js';
import {
  create_code_verifier,
  create_code_challenge,
  create_state,
} from './pkce.js';
import { save_tokens, tokens_from_api_response, load_tokens } from './token_store.js';

/**
 * 組合使用者需開啟的授權 URL
 * @param {string} state
 * @param {string} code_challenge
 * @param {{ show_dialog?: boolean }} [options]
 */
export function build_authorize_url(state, code_challenge, options) {
  const opts = options || {};
  const client_id = get_client_id();
  const params = new URLSearchParams({
    client_id,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge,
  });
  if (opts.show_dialog === true) {
    params.set('show_dialog', 'true');
  }
  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

/**
 * 建立新的 PKCE 工作階段（記憶體內保存 verifier 與 state）
 */
export function create_auth_session() {
  const code_verifier = create_code_verifier();
  const code_challenge = create_code_challenge(code_verifier);
  const state = create_state();
  return { code_verifier, code_challenge, state };
}

/**
 * 用 authorization code 換取 token
 * @param {string} code
 * @param {string} code_verifier
 */
export async function exchange_code_for_tokens(code, code_verifier) {
  const client_id = get_client_id();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id,
    code_verifier,
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Token 交換失敗：無法解析回應（HTTP ${response.status}）`
    );
  }

  if (!response.ok) {
    const err = data.error || 'unknown_error';
    const desc = data.error_description || text;
    throw new Error(`Token 交換失敗（${err}）：${desc}`);
  }

  const stored = tokens_from_api_response(data, load_tokens());
  save_tokens(stored);
  return stored;
}

/**
 * 使用 refresh_token 更新 access_token
 * @param {string} refresh_token
 */
export async function refresh_access_token(refresh_token) {
  if (!refresh_token) {
    throw new Error('沒有 refresh_token，請重新執行授權流程。');
  }

  const client_id = get_client_id();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token,
    client_id,
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Token 更新失敗：無法解析回應（HTTP ${response.status}）`
    );
  }

  if (!response.ok) {
    const err = data.error || 'unknown_error';
    const desc = data.error_description || text;
    throw new Error(`Token 更新失敗（${err}）：${desc}`);
  }

  const stored = tokens_from_api_response(data, load_tokens());
  save_tokens(stored);
  return stored;
}
