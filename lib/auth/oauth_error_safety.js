/**
 * OAuth 錯誤訊息安全化（M3）
 * 不向使用者／日誌輸出 Spotify 原始 body 或憑證片段
 */

/** @typedef {'authorize_redirect' | 'token_exchange' | 'token_refresh'} OAuthErrorPhase */

const AUTHORIZE_ERROR_ZH = {
  access_denied: '您已拒絕授權或取消登入，請重新執行授權指令。',
  invalid_request: '授權請求無效，請關閉此頁並重新執行 npm start 或備份指令。',
  unauthorized_client: '此 Client ID 無法使用此授權方式，請檢查 Spotify Dashboard 與 .env。',
  unsupported_response_type: '授權回應類型不受支援，請回報此為程式設定問題。',
  invalid_scope: '請求的權限範圍無效，請檢查專案 OAuth scope 設定。',
  server_error: 'Spotify 授權伺服器暫時錯誤，請稍後再試。',
  temporarily_unavailable: 'Spotify 授權服務暫時無法使用，請稍後再試。',
};

const TOKEN_ENDPOINT_ERROR_ZH = {
  invalid_grant:
    '授權碼或 refresh token 已失效、已使用或遭撤銷，請重新完成瀏覽器授權。',
  invalid_client: 'Client ID 設定有誤或未在 Spotify Dashboard 註冊，請檢查 .env。',
  invalid_request: 'Token 請求參數無效，請重新執行授權流程。',
  unauthorized_client: '此應用程式未獲准使用此 grant 類型。',
  unsupported_grant_type: '不支援的 grant 類型（程式設定問題）。',
  invalid_scope: 'Token 請求的 scope 無效，可能需要重新授權。',
};

/** Spotify 類 token 片段（寬鬆比對，用於 redact） */
const TOKEN_LIKE = /(?:BQA[A-Za-z0-9_-]{16,}|AQ[A-Za-z0-9_-]{20,})/g;

/**
 * @param {string} text
 */
export function oauth_message_contains_secret(text) {
  if (!text) {
    return false;
  }
  const raw = String(text);
  const lower = raw.toLowerCase();
  if (
    /\b(refresh_token|access_token|code_verifier|authorization_code|client_secret)\s*=\s*(?!\[已遮蔽\])[^\s&]+/i.test(
      raw
    )
  ) {
    return true;
  }
  if (lower.indexOf('bearer ') >= 0 && raw.indexOf('[已遮蔽]') < 0) {
    return true;
  }
  if (TOKEN_LIKE.test(raw)) {
    TOKEN_LIKE.lastIndex = 0;
    return true;
  }
  TOKEN_LIKE.lastIndex = 0;
  return false;
}

/**
 * 供 HTML／終端機顯示的使用者訊息（移除疑似憑證）
 * @param {string} text
 */
export function redact_oauth_secrets_in_text(text) {
  let out = String(text || '');
  out = out.replace(TOKEN_LIKE, '[已遮蔽]');
  TOKEN_LIKE.lastIndex = 0;
  out = out.replace(
    /\b(refresh_token|access_token|code_verifier|authorization_code|client_secret)\s*=\s*[^\s&]+/gi,
    '$1=[已遮蔽]'
  );
  return out;
}

/**
 * @param {OAuthErrorPhase} phase
 * @param {string} [error_code]
 */
function map_error_code_zh(phase, error_code) {
  const code = String(error_code || 'unknown_error').toLowerCase();
  if (phase === 'authorize_redirect') {
    if (Object.prototype.hasOwnProperty.call(AUTHORIZE_ERROR_ZH, code)) {
      return AUTHORIZE_ERROR_ZH[code];
    }
    return 'Spotify 授權失敗，請重新執行授權指令。';
  }
  if (Object.prototype.hasOwnProperty.call(TOKEN_ENDPOINT_ERROR_ZH, code)) {
    return TOKEN_ENDPOINT_ERROR_ZH[code];
  }
  if (phase === 'token_refresh') {
    return '無法更新 access token，請重新完成 OAuth 授權。';
  }
  return 'Token 交換失敗，請重新完成 OAuth 授權。';
}

export class OAuthTokenEndpointError extends Error {
  /**
   * @param {OAuthErrorPhase} phase
   * @param {number} http_status
   * @param {string} error_code
   * @param {string} user_message_zh
   */
  constructor(phase, http_status, error_code, user_message_zh) {
    super(user_message_zh);
    this.name = 'OAuthTokenEndpointError';
    this.phase = phase;
    this.http_status = http_status;
    this.error_code = error_code;
  }
}

/**
 * @param {OAuthErrorPhase} phase
 * @param {number} http_status
 * @param {unknown} parsed_body
 */
export function throw_token_endpoint_error(phase, http_status, parsed_body) {
  const body =
    parsed_body && typeof parsed_body === 'object' ? parsed_body : {};
  const error_code =
    typeof body.error === 'string' ? body.error : 'unknown_error';
  const user_zh = map_error_code_zh(phase, error_code);
  const prefix =
    phase === 'token_refresh' ? 'Token 更新失敗' : 'Token 交換失敗';
  throw new OAuthTokenEndpointError(
    phase,
    http_status,
    error_code,
    `${prefix}（HTTP ${http_status}，${error_code}）：${user_zh}`
  );
}

/**
 * @param {string} error_param
 * @param {string|null|undefined} _error_description - 不使用原始描述
 */
export function build_authorize_callback_user_message(error_param, _error_description) {
  const code = String(error_param || 'unknown_error').toLowerCase();
  return map_error_code_zh('authorize_redirect', code);
}

/**
 * 僅含 HTTP 狀態與錯誤類別，供 console 除錯
 * @param {string} context_zh
 * @param {number|null} http_status
 * @param {string|null} error_code
 */
export function format_oauth_console_detail(context_zh, http_status, error_code) {
  const parts = [String(context_zh || 'OAuth')];
  if (http_status != null && !Number.isNaN(Number(http_status))) {
    parts.push(`HTTP ${http_status}`);
  }
  if (error_code) {
    parts.push(String(error_code));
  }
  return parts.join(' · ');
}

/**
 * 將任意 Error.message 轉為可安全寫入日誌的字串
 * @param {string} message
 */
export function sanitize_oauth_log_message(message) {
  const raw = String(message || '');
  if (!oauth_message_contains_secret(raw)) {
    return raw.length > 240 ? raw.slice(0, 240) + '…' : raw;
  }
  return redact_oauth_secrets_in_text(raw);
}

const GENERIC_OAUTH_FAILURE_ZH =
  '授權或 Token 更新過程發生錯誤，請重新執行授權流程。';

/**
 * 供瀏覽器 HTML 顯示，避免未預期 Error 夾帶敏感 message
 * @param {unknown} err
 */
export function oauth_error_for_user_display(err) {
  if (err instanceof OAuthTokenEndpointError) {
    return err.message;
  }
  const msg =
    err && typeof err === 'object' && 'message' in err
      ? String(err.message)
      : '';
  if (!msg || oauth_message_contains_secret(msg)) {
    return GENERIC_OAUTH_FAILURE_ZH;
  }
  const safe = sanitize_oauth_log_message(msg);
  return safe || GENERIC_OAUTH_FAILURE_ZH;
}

/**
 * Console 用單行字串；不可傳入完整 Error 物件以免 util.inspect 洩漏欄位
 * @param {string} context_zh
 * @param {unknown} err
 */
export function format_oauth_unexpected_error_log(context_zh, err) {
  if (err instanceof OAuthTokenEndpointError) {
    return format_oauth_console_detail(
      context_zh,
      err.http_status,
      err.error_code
    );
  }
  const name =
    err && typeof err === 'object' && err.name
      ? String(err.name)
      : 'Error';
  let msg = '';
  if (err && typeof err === 'object' && 'message' in err) {
    msg = sanitize_oauth_log_message(String(err.message));
  }
  if (!msg || oauth_message_contains_secret(msg)) {
    return `${context_zh} · ${name} · unexpected_error`;
  }
  return `${context_zh} · ${name} · ${msg}`;
}

/**
 * @param {string} raw_text
 * @param {number} http_status
 */
export function throw_token_endpoint_unparseable(phase, raw_text, http_status) {
  if (oauth_message_contains_secret(raw_text)) {
    throw_token_endpoint_error(phase, http_status, {
      error: 'invalid_response',
    });
    return;
  }
  const prefix =
    phase === 'token_refresh' ? 'Token 更新失敗' : 'Token 交換失敗';
  throw new OAuthTokenEndpointError(
    phase,
    http_status,
    'invalid_response',
    `${prefix}：無法解析 Spotify 回應（HTTP ${http_status}）。`
  );
}
