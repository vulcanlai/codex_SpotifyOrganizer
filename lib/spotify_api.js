/**
 * Spotify Web API 呼叫：分頁、錯誤處理、401 自動 refresh
 */
import { SPOTIFY_API_BASE } from './config.js';
import {
  load_tokens,
  is_access_token_valid,
} from './token_store.js';
import { refresh_access_token } from './spotify_auth.js';
import { assert_track_api_budget, is_track_catalog_api_url } from './enrichment/track_api_budget.js';
import {
  assert_track_api_not_globally_rate_limited,
  parse_retry_after_header,
  record_track_api_rate_limit,
  print_rate_limit_cooldown_notice,
  GlobalRateLimitStateError,
} from './enrichment/rate_limit_state.js';

/** @typedef {{ status: number, retry_after?: number, body?: unknown }} SpotifyApiError */

/**
 * 可重試的 API 錯誤（含 HTTP 狀態）
 */
export class SpotifyRequestError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {unknown} [body]
   * @param {number} [retry_after_sec]
   */
  constructor(message, status, body, retry_after_sec) {
    super(message);
    this.name = 'SpotifyRequestError';
    this.status = status;
    this.body = body;
    this.retry_after_sec = retry_after_sec;
  }
}

/**
 * 確保有可用的 access_token（必要時 refresh）
 * @returns {Promise<string>}
 */
export async function get_valid_access_token() {
  let tokens = load_tokens();
  if (!tokens) {
    throw new Error('尚未授權，請先完成 OAuth 流程。');
  }

  if (is_access_token_valid(tokens)) {
    return tokens.access_token;
  }

  tokens = await refresh_access_token(tokens.refresh_token);
  return tokens.access_token;
}

/**
 * 對 Spotify API 發送 GET（含 429 重試、401  refresh 一次）
 * @param {string} path_or_url - 相對路徑如 /me 或完整 next URL
 * @param {object} [options]
 * @param {boolean} [options.retried_401]
 * @param {number} [options.rate_retry_count]
 * @param {number} [options.max_rate_retries] - 429 最多重試次數（預設 5）
 * @param {number} [options.max_retry_after_sec] - 429 Retry-After 超過此秒數則不重試
 * @param {import('./enrichment/track_api_budget.js').create_track_api_budget} [options.track_api_budget]
 * @param {boolean} [options.skip_global_rate_limit_check]
 * @param {boolean} [options.skip_global_rate_limit_persist]
 * @param {string} [options.rate_limit_source]
 */
export async function spotify_get(path_or_url, options) {
  return spotify_api_call('GET', path_or_url, null, options);
}

/**
 * @param {string} path - 相對路徑
 * @param {object|null} body
 * @param {object} [options]
 */
export async function spotify_post(path, body, options) {
  return spotify_api_call('POST', path, body, options);
}

/**
 * @param {string} method
 * @param {string} path_or_url
 * @param {object|null} body
 * @param {object} [options]
 */
export async function spotify_api_call(method, path_or_url, body, options) {
  const opts = options || {};
  const retried_401 = opts.retried_401 === true;
  const rate_retry_count = opts.rate_retry_count || 0;
  const max_rate_retries =
    typeof opts.max_rate_retries === 'number' ? opts.max_rate_retries : 5;
  const max_retry_after_sec =
    typeof opts.max_retry_after_sec === 'number'
      ? opts.max_retry_after_sec
      : null;

  const url = path_or_url.startsWith('http')
    ? path_or_url
    : `${SPOTIFY_API_BASE}${path_or_url.startsWith('/') ? '' : '/'}${path_or_url}`;

  const is_track_api = is_track_catalog_api_url(url);
  if (is_track_api) {
    assert_track_api_not_globally_rate_limited(opts);
  }

  assert_track_api_budget(url, opts);

  let access_token;
  try {
    access_token = await get_valid_access_token();
  } catch (err) {
    throw err;
  }

  /** @type {Record<string, string>} */
  const headers = {
    Authorization: `Bearer ${access_token}`,
    Accept: 'application/json',
  };
  let fetch_body;
  if (body != null && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    fetch_body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, {
      method: method,
      headers: headers,
      body: fetch_body,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    throw new SpotifyRequestError(
      `網路錯誤，無法連線 Spotify API：${msg}`,
      0
    );
  }

  if (response.status === 401 && !retried_401) {
    const tokens = load_tokens();
    if (tokens && tokens.refresh_token) {
      await refresh_access_token(tokens.refresh_token);
      return spotify_api_call(method, path_or_url, body, {
        retried_401: true,
        rate_retry_count,
        max_rate_retries,
        max_retry_after_sec,
        track_api_budget: opts.track_api_budget,
        skip_global_rate_limit_check: opts.skip_global_rate_limit_check,
        skip_global_rate_limit_persist: opts.skip_global_rate_limit_persist,
        rate_limit_source: opts.rate_limit_source,
      });
    }
    throw new SpotifyRequestError(
      '未授權（401）：access token 無效且無法更新，請重新授權。',
      401
    );
  }

  if (response.status === 429) {
    const retry_header = response.headers.get('Retry-After');
    const observed_ms = Date.now();
    const parsed = parse_retry_after_header(retry_header, observed_ms);
    const wait_sec = parsed.retry_after_seconds;
    const summary_base = parsed.retry_after_inferred
      ? `請求過於頻繁（429），Retry-After 缺失或無法解析，採保守冷卻 ${wait_sec} 秒（推估）。`
      : `請求過於頻繁（429），Retry-After ${wait_sec} 秒。`;

    if (is_track_api && opts.skip_global_rate_limit_persist !== true) {
      try {
        const saved = record_track_api_rate_limit({
          observed_at_ms: observed_ms,
          retry_after_seconds: wait_sec,
          retry_after_inferred: parsed.retry_after_inferred,
          inference_reason: parsed.inference_reason || null,
          source: opts.rate_limit_source || 'spotify_api:GET /v1/tracks/{id}',
          last_error_summary:
            max_retry_after_sec != null && wait_sec > max_retry_after_sec
              ? `${summary_base} 超過允許等待上限 ${max_retry_after_sec} 秒。`
              : summary_base,
        });
        print_rate_limit_cooldown_notice(saved);
      } catch (persist_err) {
        const msg =
          persist_err && persist_err.message
            ? persist_err.message
            : String(persist_err);
        if (persist_err instanceof GlobalRateLimitStateError) {
          throw persist_err;
        }
        throw new Error(`無法寫入 rate-limit-state.json，已停止 Track API 查詢：${msg}`);
      }
    }

    if (
      max_retry_after_sec != null &&
      wait_sec > max_retry_after_sec
    ) {
      throw new SpotifyRequestError(
        `請求過於頻繁（429），Retry-After ${wait_sec} 秒超過允許等待上限 ${max_retry_after_sec} 秒。`,
        429,
        null,
        wait_sec
      );
    }
    if (rate_retry_count >= max_rate_retries) {
      throw new SpotifyRequestError(
        '請求過於頻繁（429），已重試多次仍失敗。',
        429,
        null,
        wait_sec
      );
    }
    await sleep(wait_sec * 1000);
    return spotify_api_call(method, path_or_url, body, {
      retried_401,
      rate_retry_count: rate_retry_count + 1,
      max_rate_retries,
      max_retry_after_sec,
      track_api_budget: opts.track_api_budget,
      skip_global_rate_limit_check: opts.skip_global_rate_limit_check,
      skip_global_rate_limit_persist: opts.skip_global_rate_limit_persist,
      rate_limit_source: opts.rate_limit_source,
    });
  }

  const text = await response.text();
  let response_body;
  try {
    response_body = text ? JSON.parse(text) : null;
  } catch {
    response_body = text;
  }

  if (!response.ok) {
    const spotify_msg =
      response_body && response_body.error && response_body.error.message
        ? response_body.error.message
        : `HTTP ${response.status}`;
    if (response.status === 403) {
      throw new SpotifyRequestError(
        `禁止存取（403）：${spotify_msg}。請確認 App 設定與 scope 是否足夠。`,
        403,
        response_body
      );
    }
    throw new SpotifyRequestError(
      `Spotify API 錯誤：${spotify_msg}`,
      response.status,
      response_body
    );
  }

  return response_body;
}

/**
 * 依 next 連結抓取所有分頁
 * @param {string} first_path - 例如 /me/playlists?limit=50
 * @returns {Promise<{ items: unknown[], total_from_api: number|null, pages: number }>}
 */
export async function fetch_all_pages(first_path) {
  const all_items = [];
  let url = first_path;
  let pages = 0;
  let reported_total = null;

  while (url) {
    const page = await spotify_get(url);
    pages += 1;

    if (!page || typeof page !== 'object') {
      throw new SpotifyRequestError(
        'Spotify API 回傳格式異常：分頁內容不是物件。',
        0,
        page
      );
    }

    if (typeof page.total === 'number') {
      reported_total = page.total;
    }

    const items = Array.isArray(page.items) ? page.items : [];
    for (let i = 0; i < items.length; i += 1) {
      all_items.push(items[i]);
    }

    url = page.next ? page.next : null;
  }

  return {
    items: all_items,
    total_from_api: reported_total,
    pages,
  };
}

/**
 * GET /v1/me
 */
export async function fetch_current_user() {
  return spotify_get('/me');
}

/**
 * 使用者建立／追蹤的歌單（含 private / collaborative）
 */
export async function fetch_all_playlists() {
  return fetch_all_pages('/me/playlists?limit=50');
}

/**
 * 已按讚（保存）的歌曲
 */
export async function fetch_all_saved_tracks() {
  return fetch_all_pages('/me/tracks?limit=50');
}

/**
 * 使用者收藏專輯（Your Music）
 */
export async function fetch_all_saved_albums() {
  return fetch_all_pages('/me/albums?limit=50');
}

/**
 * 單一專輯曲目（catalog），完整分頁
 * @param {string} album_id
 */
export async function fetch_all_album_tracks(album_id) {
  const encoded = encodeURIComponent(album_id);
  return fetch_all_pages(`/albums/${encoded}/tracks?limit=50`);
}

/**
 * 讀取單一歌單內所有項目（曲目／episode），完整分頁
 * Spotify：GET /playlists/{id}/items（2026 起取代舊版 /tracks）
 * @param {string} playlist_id
 * @returns {Promise<{ items: unknown[], total_from_api: number|null, pages: number }>}
 */
export async function fetch_all_playlist_tracks(playlist_id) {
  const encoded = encodeURIComponent(playlist_id);
  const first = `/playlists/${encoded}/items?limit=50&additional_types=track%2Cepisode`;
  return fetch_all_pages(first);
}

/**
 * 已追蹤藝人單頁（cursor：after，不可用 offset）
 * @param {string|null} after
 * @param {number} [limit] - 1–50
 */
/**
 * 目錄曲目 metadata（GET /v1/tracks/{id}）
 * @param {string} track_id
 * @param {object} [options] - 傳入 spotify_get 選項
 */
export async function fetch_track_catalog(track_id, options) {
  const encoded = encodeURIComponent(track_id);
  return spotify_get(`/tracks/${encoded}`, options);
}

export async function fetch_followed_artists_page(after, limit) {
  const lim = typeof limit === 'number' ? limit : 50;
  const capped = lim > 50 ? 50 : lim < 1 ? 1 : lim;
  let path = `/me/following?type=artist&limit=${capped}`;
  if (after) {
    path += `&after=${encodeURIComponent(after)}`;
  }
  return spotify_get(path);
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}
