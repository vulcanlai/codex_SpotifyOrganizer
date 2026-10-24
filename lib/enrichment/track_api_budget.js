/**
 * Track API（GET /tracks/{id}）查詢預算計數
 * OAuth token 端點不計入此預算
 */

export class TrackApiBudgetExhaustedError extends Error {
  constructor() {
    super('Track API 查詢預算已用盡，停止發出新的曲目請求。');
    this.name = 'TrackApiBudgetExhaustedError';
  }
}

/**
 * @param {number} total
 */
export function create_track_api_budget(total) {
  const limit = typeof total === 'number' && total > 0 ? total : 0;
  let consumed = 0;

  return {
    total: limit,
    consumed: function () {
      return consumed;
    },
    remaining: function () {
      return limit - consumed;
    },
    /**
     * 消耗 1 次 Track API attempt（含 429/401 重試）
     * @returns {boolean}
     */
    try_consume: function () {
      if (consumed >= limit) {
        return false;
      }
      consumed += 1;
      return true;
    },
  };
}

/**
 * @param {string} url_or_path
 */
export function is_track_catalog_api_url(url_or_path) {
  const s = url_or_path || '';
  return /\/tracks\/[^/?#]+/.test(s);
}

/**
 * @param {string} url_or_path
 * @param {object} [opts] - spotify_get options
 */
export function assert_track_api_budget(url_or_path, opts) {
  const options = opts || {};
  if (!is_track_catalog_api_url(url_or_path)) {
    return;
  }
  const budget = options.track_api_budget;
  if (!budget || typeof budget.try_consume !== 'function') {
    return;
  }
  if (!budget.try_consume()) {
    throw new TrackApiBudgetExhaustedError();
  }
}
