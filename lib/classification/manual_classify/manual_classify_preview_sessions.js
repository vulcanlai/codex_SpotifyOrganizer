/**
 * 人工分類 Preview 工作階段（記憶體；伺服器重啟後清空）
 */
import crypto from 'node:crypto';

/** 預設 30 分鐘 */
let preview_token_ttl_ms = 30 * 60 * 1000;

const MAX_PREVIEW_SESSIONS = 500;

/**
 * @typedef {object} ManualClassifyPreviewSession
 * @property {object} normalized_request
 * @property {string} overrides_fingerprint
 * @property {string} g3_f_registry_fingerprint
 * @property {number} issued_at_ms
 * @property {number} expires_at_ms
 * @property {boolean} consumed
 */

/** @type {Map<string, ManualClassifyPreviewSession>} */
const preview_sessions = new Map();

/** @type {string|null} */
let apply_inflight_preview_token = null;

function purge_expired_preview_sessions() {
  const now = Date.now();
  const keys = Array.from(preview_sessions.keys());
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const row = preview_sessions.get(key);
    if (!row || row.expires_at_ms <= now) {
      preview_sessions.delete(key);
    }
  }
}

function trim_preview_session_map() {
  while (preview_sessions.size > MAX_PREVIEW_SESSIONS) {
    const first = preview_sessions.keys().next().value;
    preview_sessions.delete(first);
  }
}

/**
 * @param {object} normalized_request
 * @param {string} overrides_fingerprint
 * @param {string} g3_f_registry_fingerprint
 */
export function issue_manual_classify_preview_token(
  normalized_request,
  overrides_fingerprint,
  g3_f_registry_fingerprint
) {
  purge_expired_preview_sessions();
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  preview_sessions.set(token, {
    normalized_request: JSON.parse(JSON.stringify(normalized_request || {})),
    overrides_fingerprint: overrides_fingerprint,
    g3_f_registry_fingerprint: g3_f_registry_fingerprint,
    issued_at_ms: now,
    expires_at_ms: now + preview_token_ttl_ms,
    consumed: false,
  });
  trim_preview_session_map();
  return token;
}

/**
 * @param {object} a
 * @param {object} b
 */
function normalized_requests_equal(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

/**
 * @param {string} token
 * @param {object} normalized_request
 * @param {string} client_overrides_fingerprint
 */
export function validate_manual_classify_preview_token(
  token,
  normalized_request,
  client_overrides_fingerprint
) {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (!trimmed) {
    return { ok: false, error: 'missing_preview_token' };
  }
  const client_fp =
    typeof client_overrides_fingerprint === 'string'
      ? client_overrides_fingerprint.trim()
      : '';
  if (!client_fp) {
    return {
      ok: false,
      error: 'missing_overrides_fingerprint',
      message_zh: '缺少 overrides_fingerprint，請重新預覽。',
    };
  }
  const session = preview_sessions.get(trimmed);
  if (!session) {
    purge_expired_preview_sessions();
    return {
      ok: false,
      error: 'invalid_preview_token',
      message_zh: 'Preview token 無效或已過期，請重新預覽。',
    };
  }
  if (session.consumed) {
    return {
      ok: false,
      error: 'duplicate_apply',
      message_zh: '此預覽已套用過，請重新預覽後再試。',
    };
  }
  if (Date.now() > session.expires_at_ms) {
    preview_sessions.delete(trimmed);
    purge_expired_preview_sessions();
    return {
      ok: false,
      error: 'preview_token_expired',
      message_zh: 'Preview token 已過期，請重新預覽。',
    };
  }
  purge_expired_preview_sessions();
  if (!normalized_requests_equal(normalized_request, session.normalized_request)) {
    return {
      ok: false,
      error: 'preview_token_mismatch',
      message_zh: '預覽 token 與請求不一致，請重新預覽。',
    };
  }
  if (client_fp !== session.overrides_fingerprint) {
    return {
      ok: false,
      error: 'stale_preview',
      message_zh: 'manual-overrides 指紋與預覽不一致，請重新預覽。',
    };
  }
  return { ok: true, session: session };
}

/**
 * @param {object} session
 * @param {string} fresh_overrides_fingerprint
 * @param {string} fresh_g3_f_registry_fingerprint
 */
export function preview_session_data_still_fresh(
  session,
  fresh_overrides_fingerprint,
  fresh_g3_f_registry_fingerprint
) {
  if (fresh_overrides_fingerprint !== session.overrides_fingerprint) {
    return {
      ok: false,
      error: 'stale_preview',
      message_zh: 'manual-overrides 已變更，請重新預覽後再寫入。',
    };
  }
  if (fresh_g3_f_registry_fingerprint !== session.g3_f_registry_fingerprint) {
    return {
      ok: false,
      error: 'stale_preview',
      message_zh: 'G3-F registry 已變更，請重新預覽後再寫入。',
    };
  }
  return { ok: true };
}

/**
 * @param {string} token
 */
export function mark_manual_classify_preview_token_consumed(token) {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  const session = preview_sessions.get(trimmed);
  if (session) {
    session.consumed = true;
  }
}

export function try_begin_manual_classify_apply(token) {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (
    apply_inflight_preview_token &&
    apply_inflight_preview_token !== trimmed
  ) {
    return {
      ok: false,
      error: 'apply_in_progress',
      message_zh: '另一筆套用進行中，請稍後。',
    };
  }
  apply_inflight_preview_token = trimmed;
  return { ok: true };
}

export function end_manual_classify_apply_inflight() {
  apply_inflight_preview_token = null;
}

/** 測試用 */
export function reset_manual_classify_preview_sessions_for_tests() {
  preview_sessions.clear();
  apply_inflight_preview_token = null;
}

/** 測試用 */
export function set_manual_classify_preview_token_ttl_ms_for_tests(ms) {
  preview_token_ttl_ms = ms;
}

/** 測試用 */
export function restore_manual_classify_preview_token_ttl_ms_for_tests() {
  preview_token_ttl_ms = 30 * 60 * 1000;
}

/** 測試用：直接標記 token 已消耗 */
export function mark_preview_token_consumed_for_tests(token) {
  mark_manual_classify_preview_token_consumed(token);
}

/** 測試用：讀取 session（不暴露 token 給 production） */
export function get_manual_classify_preview_session_for_tests(token) {
  return preview_sessions.get(token) || null;
}
