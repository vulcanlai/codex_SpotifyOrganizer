/**
 * Spotify 播放清單建立與批次加入曲目（私人歌單）
 * 加入／讀取曲目使用 GET|POST /playlists/{id}/items（非舊版 /tracks）
 */
import { spotify_get, spotify_post, spotify_api_call } from './spotify_api.js';
import { resolve_media_from_row } from './backup/track_normalize.js';

export const SPOTIFY_ADD_TRACKS_MAX = 100;

/**
 * @param {object} params
 */
/**
 * 僅更新歌單 metadata（name／description）；不修改曲目
 * @param {string} playlist_id
 * @param {{ name?: string, description?: string }} params
 */
/**
 * PUT /playlists/{id} 常見 200 空 body；以請求值回填
 * @param {unknown} api_response
 * @param {string} playlist_id
 * @param {{ name?: string, description?: string }} request_params
 */
export function resolve_playlist_details_after_put(
  api_response,
  playlist_id,
  request_params
) {
  const p = request_params || {};
  const payload =
    api_response &&
    typeof api_response === 'object' &&
    !Array.isArray(api_response)
      ? api_response
      : null;
  return {
    spotify_playlist_id: playlist_id,
    name:
      payload && payload.name != null
        ? payload.name
        : typeof p.name === 'string'
          ? p.name
          : null,
    description:
      payload && payload.description != null
        ? payload.description
        : typeof p.description === 'string'
          ? p.description
          : null,
    api_response_empty: payload == null,
  };
}

export async function update_playlist_details(playlist_id, params, options) {
  const encoded = encodeURIComponent(playlist_id);
  const p = params || {};
  const body = {};
  if (typeof p.name === 'string') {
    body.name = p.name;
  }
  if (typeof p.description === 'string') {
    body.description = p.description;
  }
  if (Object.keys(body).length === 0) {
    return { spotify_playlist_id: playlist_id, name: null, description: null };
  }
  const res = await spotify_api_call(
    'PUT',
    `/playlists/${encoded}`,
    body,
    options
  );
  return resolve_playlist_details_after_put(res, playlist_id, p);
}

export async function create_private_playlist(params, options) {
  const p = params || {};
  const body = {
    name: p.name,
    description: p.description || '',
    public: false,
    collaborative: false,
  };
  const res = await spotify_post('/me/playlists', body, options);
  return {
    spotify_playlist_id: res.id,
    uri: res.uri,
    name: res.name,
  };
}

/**
 * @param {string} playlist_id
 * @param {string[]} track_uris
 */
export async function add_tracks_to_playlist(playlist_id, track_uris, options) {
  const encoded = encodeURIComponent(playlist_id);
  const uris = track_uris || [];
  if (!uris.length) {
    return { snapshot_id: null, added: 0 };
  }
  const res = await spotify_post(
    `/playlists/${encoded}/items`,
    { uris: uris },
    options
  );
  return {
    snapshot_id: res.snapshot_id,
    added: uris.length,
  };
}

/**
 * 讀取歌單現有 track uri（去重用）
 * @param {string} playlist_id
 */
export async function fetch_playlist_track_uris(playlist_id, options) {
  const encoded = encodeURIComponent(playlist_id);
  /** @type {Set<string>} */
  const uris = new Set();
  let path =
    `/playlists/${encoded}/items?limit=100&additional_types=track&fields=items(item(uri)),next`;
  while (path) {
    const page = await spotify_get(path, options);
    const items = page.items || [];
    for (let i = 0; i < items.length; i += 1) {
      const media = resolve_media_from_row(items[i]);
      if (media && typeof media.uri === 'string' && media.uri.indexOf('spotify:track:') === 0) {
        uris.add(media.uri);
      }
    }
    path = page.next ? page.next.replace(/^https:\/\/api\.spotify\.com\/v1/, '') : null;
  }
  return uris;
}

/**
 * @param {string[]} uris
 */
export function chunk_uris(uris, size) {
  const n = size || SPOTIFY_ADD_TRACKS_MAX;
  const out = [];
  for (let i = 0; i < uris.length; i += n) {
    out.push(uris.slice(i, i + n));
  }
  return out;
}
