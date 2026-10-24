/**
 * 收藏專輯 API 小規模唯讀探測（不寫入 backup）
 */
import { spotify_get, SpotifyRequestError } from '../spotify_api.js';

/**
 * 從 Spotify error body 取出可公開的摘要
 * @param {unknown} body
 */
export function spotify_error_summary(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const err = body.error;
  if (!err || typeof err !== 'object') {
    return null;
  }
  return {
    status: typeof err.status === 'number' ? err.status : null,
    message: typeof err.message === 'string' ? err.message : null,
  };
}

/**
 * 解析 GET /me/albums 第一頁（limit=5）
 */
export async function probe_saved_albums_page() {
  const path = '/me/albums?limit=5&offset=0';
  try {
    const body = await spotify_get(path);
    const total = typeof body.total === 'number' ? body.total : null;
    const items = Array.isArray(body.items) ? body.items : [];
    /** @type {object[]} */
    const albums = [];
    for (let i = 0; i < items.length && i < 5; i += 1) {
      const row = items[i];
      const album = row && row.album ? row.album : null;
      if (!album || !album.id) {
        continue;
      }
      albums.push({
        index: i + 1,
        album_id: album.id,
        name: album.name || null,
        total_tracks:
          typeof album.total_tracks === 'number' ? album.total_tracks : null,
        added_at: typeof row.added_at === 'string' ? row.added_at : null,
      });
    }

    return {
      ok: true,
      http_status: 200,
      endpoint: 'GET /v1/me/albums',
      total,
      albums_preview: albums,
      raw_item_count: items.length,
    };
  } catch (err) {
    return probe_fail('GET /v1/me/albums', err);
  }
}

/**
 * @param {string} album_id
 */
export async function probe_album_tracks_page(album_id) {
  const encoded = encodeURIComponent(album_id);
  const path = `/albums/${encoded}/tracks?limit=5&offset=0`;
  try {
    const body = await spotify_get(path);
    const total = typeof body.total === 'number' ? body.total : null;
    const items = Array.isArray(body.items) ? body.items : [];
    const tracks = [];
    for (let i = 0; i < items.length && i < 5; i += 1) {
      const tr = items[i];
      tracks.push({
        index: i + 1,
        track_id: tr && tr.id ? tr.id : null,
        name: tr && tr.name ? tr.name : null,
      });
    }
    return {
      ok: true,
      http_status: 200,
      endpoint: 'GET /v1/albums/{id}/tracks',
      album_id,
      total,
      tracks_preview: tracks,
    };
  } catch (err) {
    return probe_fail('GET /v1/albums/{id}/tracks', err);
  }
}

/**
 * @param {string} label
 * @param {unknown} err
 */
function probe_fail(label, err) {
  if (err instanceof SpotifyRequestError) {
    const summary = spotify_error_summary(err.body);
    return {
      ok: false,
      http_status: err.status || null,
      endpoint: label,
      message: err.message,
      spotify_error: summary,
      retry_after_sec: err.retry_after_sec || null,
    };
  }
  const msg = err && err.message ? err.message : String(err);
  return {
    ok: false,
    http_status: null,
    endpoint: label,
    message: msg,
    spotify_error: null,
    retry_after_sec: null,
  };
}

/**
 * 完整探測流程（最多兩次 GET）
 */
export async function run_albums_probe() {
  const albums_result = await probe_saved_albums_page();

  let tracks_result = null;
  let tracks_skipped_reason = null;

  if (!albums_result.ok) {
    tracks_skipped_reason = '收藏專輯 API 未成功，略過專輯曲目測試。';
  } else if (albums_result.total === 0) {
    tracks_skipped_reason = '收藏專輯總數為 0，無可測試的專輯曲目。';
  } else {
    const first = pick_first_album_id(albums_result);
    if (!first) {
      tracks_skipped_reason =
        '第一頁沒有含有效 album.id 的項目，略過專輯曲目測試。';
    } else {
      tracks_result = await probe_album_tracks_page(first);
    }
  }

  return {
    albums: albums_result,
    tracks: tracks_result,
    tracks_skipped_reason,
  };
}

/**
 * @param {object} albums_result
 */
function pick_first_album_id(albums_result) {
  const list = albums_result.albums_preview || [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].album_id) {
      return list[i].album_id;
    }
  }
  return null;
}
