/**
 * GET /v1/me/following?type=artist cursor 分頁（可注入 fetch_page 供離線測試）
 */
import { SpotifyRequestError } from '../spotify_api.js';

export class FollowedArtistsPaginationError extends Error {
  /**
   * @param {string} message
   * @param {{ pages?: number, items_collected?: number }} [meta]
   */
  constructor(message, meta) {
    super(message);
    this.name = 'FollowedArtistsPaginationError';
    this.pages = meta && typeof meta.pages === 'number' ? meta.pages : 0;
    this.items_collected =
      meta && typeof meta.items_collected === 'number'
        ? meta.items_collected
        : 0;
  }
}

/**
 * @typedef {{ artists: { items?: unknown[], total?: number, next?: string|null, cursors?: { after?: string|null } } }} FollowedArtistsPageBody
 */

/**
 * @param {(after: string|null) => Promise<FollowedArtistsPageBody>} fetch_page
 * @returns {Promise<{ items: unknown[], total_from_api: number|null, pages: number, pagination_complete: boolean }>}
 */
export async function collect_all_followed_artists(fetch_page) {
  /** @type {unknown[]} */
  const all_items = [];
  const seen_cursors = new Set();
  let after = null;
  let pages = 0;
  let total_from_api = null;

  while (true) {
    const cursor_key = after === null ? '__start__' : after;
    if (seen_cursors.has(cursor_key)) {
      throw new FollowedArtistsPaginationError(
        '分頁 cursor 重複，中止以避免無限迴圈。',
        { pages, items_collected: all_items.length }
      );
    }
    seen_cursors.add(cursor_key);

    let body;
    try {
      body = await fetch_page(after);
    } catch (err) {
      if (err instanceof FollowedArtistsPaginationError) {
        throw err;
      }
      throw err;
    }

    pages += 1;
    const block = body && body.artists;
    if (!block || typeof block !== 'object') {
      throw new SpotifyRequestError(
        'Spotify API 回傳格式異常：缺少 artists 物件。',
        0,
        body
      );
    }

    if (typeof block.total === 'number') {
      total_from_api = block.total;
    }

    const items = Array.isArray(block.items) ? block.items : [];
    for (let i = 0; i < items.length; i += 1) {
      all_items.push(items[i]);
    }

    const next_url = block.next;
    const next_after =
      block.cursors && typeof block.cursors.after === 'string'
        ? block.cursors.after
        : null;

    if (!next_url) {
      return {
        items: all_items,
        total_from_api,
        pages,
        pagination_complete: true,
      };
    }

    if (!next_after) {
      throw new FollowedArtistsPaginationError(
        'API 回傳 next 連結但缺少 cursors.after，無法安全繼續分頁。',
        { pages, items_collected: all_items.length }
      );
    }

    if (
      total_from_api !== null &&
      all_items.length >= total_from_api &&
      items.length === 0
    ) {
      return {
        items: all_items,
        total_from_api,
        pages,
        pagination_complete: true,
      };
    }

    after = next_after;
  }
}
