/**
 * 人工分類 Web API 請求白名單（H1／H2：不信任 client 文件或路徑）
 */

/** @type {Set<string>} */
export const MANUAL_CLASSIFY_CLIENT_REQUEST_ALLOWED_KEYS = new Set([
  'spotify_input',
  'playlist_ids',
  'spotify_id_kind',
]);

/** @type {Set<string>} */
export const MANUAL_CLASSIFY_APPLY_BODY_ALLOWED_TOP_KEYS = new Set([
  'confirm',
  'preview_token',
  'overrides_fingerprint',
  'request',
]);

/**
 * Client 不得送出的欄位（含路徑與可篡改文件）
 * @type {Set<string>}
 */
export const MANUAL_CLASSIFY_FORBIDDEN_CLIENT_KEYS = new Set([
  'overrides_doc',
  'registry_doc',
  'album_tracks_path',
  'catalog_path',
  'manifest_path',
  'library_v2_path',
  'spotify_id_hints',
  'id_hints',
  'track_tokens',
  'album',
  'album_ids',
  'playlists',
  'playlist',
  'primary_genre',
  'genre_primary',
  'language',
  'contexts',
  'context',
  'genre_profile',
  'note_zh',
  'language_bucket',
]);

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalize_playlist_id_list(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  /** @type {string[]} */
  const ids = [];
  const seen = {};
  for (let i = 0; i < raw.length; i += 1) {
    const id = String(raw[i] || '').trim();
    if (!id || seen[id]) {
      continue;
    }
    seen[id] = true;
    ids.push(id);
  }
  return ids.sort();
}

/**
 * 僅保留 Web UI／API 允許的請求欄位（供 plan 與 preview_token 共用）
 * @param {object} raw
 */
export function normalize_manual_classify_client_request(raw) {
  const body = raw || {};
  let spotify_id_kind = body.spotify_id_kind;
  if (spotify_id_kind !== 'track' && spotify_id_kind !== 'album') {
    spotify_id_kind = null;
  }
  return {
    spotify_input:
      typeof body.spotify_input === 'string' ? body.spotify_input.trim() : '',
    spotify_id_kind: spotify_id_kind,
    playlist_ids: normalize_playlist_id_list(body.playlist_ids),
  };
}

/**
 * @param {unknown} body
 * @returns {string[]}
 */
export function get_untrusted_manual_classify_client_keys(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['<invalid_body>'];
  }
  /** @type {string[]} */
  const bad = [];
  const keys = Object.keys(body);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (!MANUAL_CLASSIFY_CLIENT_REQUEST_ALLOWED_KEYS.has(key)) {
      bad.push(key);
    }
  }
  return bad.sort();
}

/**
 * @param {unknown} body
 * @returns {string[]}
 */
export function get_untrusted_manual_classify_apply_body_keys(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['<invalid_body>'];
  }
  /** @type {string[]} */
  const bad = [];
  const keys = Object.keys(body);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (!MANUAL_CLASSIFY_APPLY_BODY_ALLOWED_TOP_KEYS.has(key)) {
      bad.push(key);
    }
  }
  const req_bad = get_untrusted_manual_classify_client_keys(body.request || {});
  for (let j = 0; j < req_bad.length; j += 1) {
    bad.push('request.' + req_bad[j]);
  }
  return bad.sort();
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, normalized: object } | { ok: false, error: string, forbidden_keys: string[] }}
 */
export function sanitize_manual_classify_preview_body(body) {
  const forbidden = get_untrusted_manual_classify_client_keys(body);
  if (forbidden.length > 0) {
    return {
      ok: false,
      error: 'untrusted_fields',
      forbidden_keys: forbidden,
    };
  }
  return {
    ok: true,
    normalized: normalize_manual_classify_client_request(body),
  };
}

/**
 * @param {unknown} body
 */
export function sanitize_manual_classify_apply_body(body) {
  const forbidden = get_untrusted_manual_classify_apply_body_keys(body);
  if (forbidden.length > 0) {
    return {
      ok: false,
      error: 'untrusted_fields',
      forbidden_keys: forbidden,
    };
  }
  return {
    ok: true,
    normalized_request: normalize_manual_classify_client_request(body.request || {}),
  };
}
