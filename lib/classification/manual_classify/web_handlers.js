/**
 * 人工分類 Web UI JSON API（僅本機）
 */
import {
  list_mvp_playlists_for_ui,
  run_manual_classify_preview,
  run_manual_classify_apply,
  build_mvp_sync_status_summary_for_ui,
  response_has_oauth_leak,
} from './manual_classify_web_service.js';

const MAX_BODY_BYTES = 512 * 1024;

/**
 * @param {string|null|undefined} remote_address
 */
export function is_local_manual_classify_client(remote_address) {
  const addr = remote_address || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * @param {string} method
 * @param {string} pathname
 * @param {string} body_text
 * @param {object} [meta]
 */
export async function handle_manual_classify_api(method, pathname, body_text, meta) {
  const m = meta || {};
  if (!is_local_manual_classify_client(m.remote_address)) {
    return json_response(403, { error: 'forbidden', message_zh: '僅允許本機存取' });
  }

  if (body_text && body_text.length > MAX_BODY_BYTES) {
    return json_response(413, { error: 'body_too_large' });
  }

  if (pathname === '/api/health' && method === 'GET') {
    const payload = {
      ok: true,
      service: 'manual-classify-ui',
      local_only: true,
    };
    return safe_json_response(200, payload);
  }

  if (pathname === '/api/playlists' && method === 'GET') {
    const data = list_mvp_playlists_for_ui();
    return safe_json_response(200, data);
  }

  if (pathname === '/api/sync-status' && method === 'GET') {
    const data = build_mvp_sync_status_summary_for_ui();
    return safe_json_response(200, data);
  }

  if (pathname === '/api/preview' && method === 'POST') {
    const body = parse_json_body(body_text);
    if (body === null || !validate_preview_body(body)) {
      return json_response(400, {
        error: 'invalid_body',
        message_zh: '需提供 spotify_input 與至少一個 playlist_id',
      });
    }
    const result = run_manual_classify_preview(body);
    return safe_json_response(200, {
      preview_token: result.preview_token,
      preview: result.preview,
    });
  }

  if (pathname === '/api/apply' && method === 'POST') {
    const body = parse_json_body(body_text);
    if (body === null || body.confirm !== true) {
      return json_response(400, {
        error: 'confirm_required',
        message_zh: '寫入需 confirm: true',
      });
    }
    if (!validate_preview_body(body.request || {})) {
      return json_response(400, { error: 'invalid_request' });
    }
    const applied = run_manual_classify_apply(body);
    if (!applied.ok) {
      const status =
        applied.error === 'duplicate_apply' || applied.error === 'apply_in_progress' ? 409 : 400;
      return safe_json_response(status, applied);
    }
    return safe_json_response(200, applied);
  }

  return null;
}

/**
 * @param {object} body
 */
function validate_preview_body(body) {
  if (!body || typeof body.spotify_input !== 'string' || !body.spotify_input.trim()) {
    return false;
  }
  if (!Array.isArray(body.playlist_ids) || body.playlist_ids.length < 1) {
    return false;
  }
  for (let i = 0; i < body.playlist_ids.length; i += 1) {
    const id = body.playlist_ids[i];
    if (typeof id !== 'string' || !id.trim()) {
      return false;
    }
    if (id.indexOf('..') >= 0 || id.indexOf('/') >= 0 || id.indexOf('\\') >= 0) {
      return false;
    }
  }
  return true;
}

function parse_json_body(text) {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safe_json_response(status, data) {
  if (response_has_oauth_leak(data)) {
    return json_response(500, { error: 'internal_sanitize_failed' });
  }
  return json_response(status, data);
}

function json_response(status, data) {
  return {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(data),
  };
}
