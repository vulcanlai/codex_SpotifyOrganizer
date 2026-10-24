/**
 * 匯入 Web UI 的 JSON API 處理（僅本機）
 */
import {
  list_restricted_playlists_with_status,
  preview_import_batch,
  apply_import_batch,
  confirm_playlist_total,
} from './import_store.js';

/**
 * @param {string} method
 * @param {string} pathname
 * @param {string} body_text
 */
export async function handle_import_api(method, pathname, body_text) {
  if (pathname === '/api/status' && method === 'GET') {
    return json_response(200, list_restricted_playlists_with_status());
  }

  if (pathname === '/api/preview' && method === 'POST') {
    const body = parse_json_body(body_text);
    if (!body.playlist_id || typeof body.text !== 'string') {
      return json_response(400, { error: '缺少 playlist_id 或 text' });
    }
    const preview = preview_import_batch(body.playlist_id, body.text);
    return json_response(200, { preview });
  }

  if (pathname === '/api/import-batch' && method === 'POST') {
    const body = parse_json_body(body_text);
    if (!body.playlist_id || typeof body.text !== 'string') {
      return json_response(400, { error: '缺少 playlist_id 或 text' });
    }
    const result = apply_import_batch(body.playlist_id, body.text, {
      allow_duplicate_batch: body.allow_duplicate_batch === true,
    });
    if (!result.ok) {
      return json_response(409, result);
    }
    return json_response(200, result);
  }

  if (pathname === '/api/confirm-playlist' && method === 'POST') {
    const body = parse_json_body(body_text);
    if (!body.playlist_id || body.expected_total === undefined) {
      return json_response(400, { error: '缺少 playlist_id 或 expected_total' });
    }
    try {
      const result = confirm_playlist_total(
        body.playlist_id,
        body.expected_total
      );
      return json_response(200, result);
    } catch (err) {
      return json_response(400, {
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  return null;
}

function parse_json_body(text) {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function json_response(status, data) {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data),
  };
}
