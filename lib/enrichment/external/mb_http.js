/**
 * MusicBrainz HTTP：速率限制、Retry-After、可注入 fetch（測試用）
 */
import {
  MB_MIN_INTERVAL_MS,
  MB_MAX_RETRIES,
  MB_USER_AGENT,
} from './paths.js';

let last_request_at = 0;

/**
 * @param {number} ms
 */
export function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * 測試用：重設節流時鐘
 */
export function reset_rate_limit_clock_for_tests() {
  last_request_at = 0;
}

/**
 * G2：區分 404 查無與可重試錯誤
 * @param {typeof fetch} fetch_fn
 * @param {string} url
 * @param {{ retry?: number }} [opts]
 */
export async function mb_fetch_json(fetch_fn, url, opts) {
  const options = opts || {};
  const retry = typeof options.retry === 'number' ? options.retry : 0;

  const now = Date.now();
  const wait = last_request_at + MB_MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await sleep(wait);
  }
  last_request_at = Date.now();

  let res;
  try {
    res = await fetch_fn(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': MB_USER_AGENT,
      },
    });
  } catch (net_err) {
    const err = new Error(
      net_err && net_err.message ? net_err.message : 'MusicBrainz network error'
    );
    err.code = 'MB_NETWORK';
    err.retryable = true;
    throw err;
  }

  if (res.status === 429 || res.status === 503) {
    if (retry >= MB_MAX_RETRIES) {
      const err = new Error('MusicBrainz rate limit or unavailable after retries');
      err.code = 'MB_RATE_LIMIT';
      err.http_status = res.status;
      err.retryable = true;
      throw err;
    }
    let delay = MB_MIN_INTERVAL_MS * (retry + 2);
    const ra = res.headers.get('Retry-After');
    if (ra) {
      const sec = parseInt(ra, 10);
      if (!isNaN(sec) && sec > 0) {
        delay = Math.max(delay, sec * 1000);
      }
    }
    await sleep(delay);
    return mb_fetch_json(fetch_fn, url, { retry: retry + 1 });
  }

  if (res.status === 404) {
    return {
      ok: false,
      http_status: 404,
      not_found: true,
      data: null,
    };
  }

  if (!res.ok) {
    const err = new Error('MusicBrainz HTTP ' + res.status);
    err.http_status = res.status;
    err.retryable = res.status >= 500;
    throw err;
  }

  const data = await res.json();
  return {
    ok: true,
    http_status: res.status,
    not_found: false,
    data: data,
  };
}

/**
 * G1 相容：成功時直接回傳 JSON；404 與其他錯誤拋例外
 * @param {typeof fetch} fetch_fn
 * @param {string} url
 * @param {{ retry?: number }} [opts]
 */
export async function mb_request(fetch_fn, url, opts) {
  const result = await mb_fetch_json(fetch_fn, url, opts);
  if (result.not_found) {
    const err = new Error('MusicBrainz HTTP 404');
    err.http_status = 404;
    err.not_found = true;
    throw err;
  }
  if (!result.ok) {
    const err = new Error('MusicBrainz HTTP ' + result.http_status);
    err.http_status = result.http_status;
    throw err;
  }
  return result.data;
}
