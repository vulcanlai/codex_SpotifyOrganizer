/**
 * 追蹤藝人 API 小規模唯讀探測（不寫入 backup）
 */
import { fetch_followed_artists_page, SpotifyRequestError } from '../spotify_api.js';
import { spotify_error_summary } from './albums_probe.js';

/**
 * GET /v1/me/following?type=artist&limit=5
 */
export async function probe_followed_artists_page() {
  const endpoint = 'GET /v1/me/following?type=artist&limit=5';
  try {
    const body = await fetch_followed_artists_page(null, 5);
    const block = body && body.artists ? body.artists : null;
    if (!block || typeof block !== 'object') {
      return {
        ok: false,
        http_status: 200,
        endpoint,
        message: 'HTTP 200 但回應缺少 artists 物件。',
        has_artists_items: false,
        has_cursors_after: false,
        has_next: false,
      };
    }

    const items = Array.isArray(block.items) ? block.items : [];
    const cursors_after =
      block.cursors && typeof block.cursors.after === 'string'
        ? block.cursors.after
        : null;
    const has_next = Boolean(block.next);

    /** @type {object[]} */
    const preview = [];
    for (let i = 0; i < items.length && i < 5; i += 1) {
      const artist = items[i];
      preview.push({
        index: i + 1,
        artist_id: artist && artist.id ? artist.id : null,
        name: artist && artist.name ? artist.name : null,
        uri: artist && artist.uri ? artist.uri : null,
      });
    }

    return {
      ok: true,
      http_status: 200,
      endpoint,
      total: typeof block.total === 'number' ? block.total : null,
      raw_item_count: items.length,
      has_artists_items: true,
      has_cursors_after: cursors_after != null && cursors_after !== '',
      cursors_after: cursors_after || null,
      has_next,
      artists_preview: preview,
    };
  } catch (err) {
    if (err instanceof SpotifyRequestError) {
      return {
        ok: false,
        http_status: err.status || null,
        endpoint,
        message: err.message,
        spotify_error: spotify_error_summary(err.body),
        retry_after_sec: err.retry_after_sec || null,
        has_artists_items: false,
        has_cursors_after: false,
        has_next: false,
      };
    }
    const msg = err && err.message ? err.message : String(err);
    return {
      ok: false,
      http_status: null,
      endpoint,
      message: msg,
      has_artists_items: false,
      has_cursors_after: false,
      has_next: false,
    };
  }
}

export async function run_artists_probe() {
  return probe_followed_artists_page();
}
