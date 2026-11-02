/**
 * Spotify Track API 全域 HTTP 429 冷卻狀態（持久化）
 */
import fs from 'node:fs';
import { format_taiwan_datetime, format_taiwan_retry_time } from '../taiwan_time.js';
import { write_json_atomic } from '../atomic_json.js';
import {
  ENRICHMENT_DIR,
  FILE_RATE_LIMIT_STATE,
  FILE_TRACK_CACHE,
} from './paths.js';

export const RATE_LIMIT_STATE_SCHEMA_VERSION = 1;

/** 缺少 Retry-After 時的保守冷卻（秒） */
export const INFERRED_RETRY_AFTER_SEC = 3600;

/** 測試用：覆寫狀態檔路徑 */
const __rate_limit_test_hooks = { file_path: null };

export function set_test_rate_limit_state_path(file_path) {
  __rate_limit_test_hooks.file_path =
    typeof file_path === 'string' ? file_path : null;
}

export function reset_test_rate_limit_state_path() {
  __rate_limit_test_hooks.file_path = null;
}

export class GlobalRateLimitStateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GlobalRateLimitStateError';
  }
}

export class GlobalRateLimitCooldownError extends Error {
  /**
   * @param {object} state - 已驗證的冷卻狀態
   * @param {number} remaining_ms
   */
  constructor(state, remaining_ms) {
    super(format_cooldown_block_message(state, remaining_ms));
    this.name = 'GlobalRateLimitCooldownError';
    this.state = state;
    this.remaining_ms = remaining_ms;
  }
}

function state_file_path() {
  return __rate_limit_test_hooks.file_path || FILE_RATE_LIMIT_STATE;
}

/**
 * 解析 Retry-After（秒數或 HTTP-date）
 * @param {string|null|undefined} header
 * @param {number} now_ms
 */
export function parse_retry_after_header(header, now_ms) {
  const now = typeof now_ms === 'number' ? now_ms : Date.now();
  if (!header || !String(header).trim()) {
    return {
      retry_after_seconds: INFERRED_RETRY_AFTER_SEC,
      retry_after_inferred: true,
      inference_reason: 'missing_retry_after_header',
    };
  }
  const trimmed = String(header).trim();
  if (/^\d+$/.test(trimmed)) {
    const sec = parseInt(trimmed, 10);
    return {
      retry_after_seconds: Number.isFinite(sec) && sec >= 0 ? sec : INFERRED_RETRY_AFTER_SEC,
      retry_after_inferred: !Number.isFinite(sec) || sec < 0,
      inference_reason: !Number.isFinite(sec) || sec < 0 ? 'invalid_seconds' : null,
    };
  }
  const date_ms = Date.parse(trimmed);
  if (Number.isFinite(date_ms)) {
    const sec = Math.max(0, Math.ceil((date_ms - now) / 1000));
    return {
      retry_after_seconds: sec,
      retry_after_inferred: false,
      parsed_as_http_date: true,
    };
  }
  return {
    retry_after_seconds: INFERRED_RETRY_AFTER_SEC,
    retry_after_inferred: true,
    inference_reason: 'unparseable_retry_after_header',
  };
}

/**
 * @param {number} observed_at_ms
 * @param {number} retry_after_seconds
 */
export function compute_retry_not_before_iso(observed_at_ms, retry_after_seconds) {
  const observed =
    typeof observed_at_ms === 'number' ? observed_at_ms : Date.now();
  const sec =
    typeof retry_after_seconds === 'number' && retry_after_seconds >= 0
      ? retry_after_seconds
      : 0;
  return new Date(observed + sec * 1000).toISOString();
}

/**
 * @param {unknown} doc
 */
export function validate_rate_limit_state_doc(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new GlobalRateLimitStateError('rate-limit-state 不是有效物件。');
  }
  if (doc.schema_version !== RATE_LIMIT_STATE_SCHEMA_VERSION) {
    throw new GlobalRateLimitStateError(
      `rate-limit-state schema_version 不支援：${doc.schema_version}`
    );
  }
  if (doc.http_status !== 429) {
    throw new GlobalRateLimitStateError('rate-limit-state http_status 必須為 429。');
  }
  if (typeof doc.retry_after_seconds !== 'number' || doc.retry_after_seconds < 0) {
    throw new GlobalRateLimitStateError('retry_after_seconds 無效。');
  }
  if (typeof doc.observed_at !== 'string' || !Number.isFinite(Date.parse(doc.observed_at))) {
    throw new GlobalRateLimitStateError('observed_at 必須為有效 ISO 8601 UTC。');
  }
  if (
    typeof doc.retry_not_before !== 'string' ||
    !Number.isFinite(Date.parse(doc.retry_not_before))
  ) {
    throw new GlobalRateLimitStateError('retry_not_before 必須為有效 ISO 8601 UTC。');
  }
  const observed_ms = Date.parse(doc.observed_at);
  const expected = compute_retry_not_before_iso(
    observed_ms,
    doc.retry_after_seconds
  );
  if (doc.retry_not_before !== expected) {
    throw new GlobalRateLimitStateError(
      'retry_not_before 與 observed_at + retry_after_seconds 不一致。'
    );
  }
  if (typeof doc.source !== 'string' || !doc.source) {
    throw new GlobalRateLimitStateError('source 不可為空。');
  }
  if (typeof doc.last_error_summary !== 'string') {
    throw new GlobalRateLimitStateError('last_error_summary 必須為字串。');
  }
  return doc;
}

/**
 * @param {number} [now_ms]
 * @returns {object|null} 仍在冷卻中的狀態；已過期回傳 null
 */
export function get_active_rate_limit_state(now_ms) {
  const doc = read_rate_limit_state_doc();
  if (!doc) {
    return null;
  }
  const now = typeof now_ms === 'number' ? now_ms : Date.now();
  const until = Date.parse(doc.retry_not_before);
  if (!Number.isFinite(until)) {
    throw new GlobalRateLimitStateError('retry_not_before 無法解析。');
  }
  if (now >= until) {
    return null;
  }
  return doc;
}

/**
 * @returns {object|null}
 */
export function read_rate_limit_state_doc() {
  const file_path = state_file_path();
  if (!fs.existsSync(file_path)) {
    return null;
  }
  let raw;
  try {
    raw = fs.readFileSync(file_path, 'utf8');
  } catch (err) {
    throw new GlobalRateLimitStateError(
      `無法讀取 rate-limit-state：${err && err.message ? err.message : err}`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GlobalRateLimitStateError('rate-limit-state.json 不是有效 JSON。');
  }
  return validate_rate_limit_state_doc(parsed);
}

/**
 * @param {object} params
 * @param {object} [opts]
 */
export function record_track_api_rate_limit(params, opts) {
  const p = params || {};
  const options = opts || {};
  const observed_ms =
    typeof p.observed_at_ms === 'number' ? p.observed_at_ms : Date.now();
  const parsed =
    typeof p.retry_after_seconds === 'number'
      ? {
          retry_after_seconds: p.retry_after_seconds,
          retry_after_inferred: p.retry_after_inferred === true,
          inference_reason: p.inference_reason || null,
        }
      : parse_retry_after_header(p.retry_after_header, observed_ms);

  const doc = {
    schema_version: RATE_LIMIT_STATE_SCHEMA_VERSION,
    status: 'active',
    http_status: 429,
    retry_after_seconds: parsed.retry_after_seconds,
    retry_after_inferred: parsed.retry_after_inferred === true,
    inference_reason: parsed.inference_reason || null,
    observed_at: new Date(observed_ms).toISOString(),
    retry_not_before: compute_retry_not_before_iso(
      observed_ms,
      parsed.retry_after_seconds
    ),
    source: p.source || 'spotify_api:GET /v1/tracks/{id}',
    last_error_summary:
      typeof p.last_error_summary === 'string' ? p.last_error_summary : '',
    historical_event_time_unknown: p.historical_event_time_unknown === true,
    updated_at: new Date().toISOString(),
  };

  validate_rate_limit_state_doc(doc);

  const persist =
    typeof options.persist_fn === 'function'
      ? options.persist_fn
      : function (d) {
          if (!fs.existsSync(ENRICHMENT_DIR)) {
            fs.mkdirSync(ENRICHMENT_DIR, { recursive: true });
          }
          write_json_atomic(state_file_path(), d);
        };

  persist(doc);
  return doc;
}

/**
 * Track API 查詢前檢查（fail-closed）
 * @param {object} [opts]
 */
export function assert_track_api_not_globally_rate_limited(opts) {
  const options = opts || {};
  if (options.skip_global_rate_limit_check === true) {
    return null;
  }
  let active;
  try {
    active = get_active_rate_limit_state(options.now_ms);
  } catch (err) {
    if (err instanceof GlobalRateLimitStateError) {
      throw err;
    }
    throw new GlobalRateLimitStateError(
      err && err.message ? err.message : String(err)
    );
  }
  if (!active) {
    return null;
  }
  const now = typeof options.now_ms === 'number' ? options.now_ms : Date.now();
  const remaining_ms = Date.parse(active.retry_not_before) - now;
  throw new GlobalRateLimitCooldownError(active, remaining_ms > 0 ? remaining_ms : 0);
}

/**
 * CLI 入口：非 dry-run 時拒絕 Track API 查詢
 * @param {string} entry_name
 * @param {object} [opts]
 */
export function assert_cli_may_query_track_api(entry_name, opts) {
  const options = opts || {};
  if (options.dry_run === true) {
    return null;
  }
  try {
    assert_track_api_not_globally_rate_limited(options);
  } catch (err) {
    if (err instanceof GlobalRateLimitCooldownError) {
      console.error(`\n[${entry_name}] ${err.message}\n`);
      throw err;
    }
    console.error(
      `\n[${entry_name}] 全域 429 冷卻狀態異常，已停止 Track API 查詢：${err.message}\n`
    );
    throw err;
  }
  return null;
}

/**
 * 從 error_summary 解析 Retry-After 秒數
 * @param {string} message
 */
export function parse_retry_after_seconds_from_message(message) {
  const m = String(message || '').match(/Retry-After\s+(\d+)\s*秒/);
  if (!m) {
    return null;
  }
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * 若狀態檔不存在，從 metadata 快取中可靠紀錄回填（不猜測時間）
 * @param {object} [opts]
 * @returns {object|null} 寫入的狀態；無法回填則 null
 */
export function try_backfill_rate_limit_state_from_cache(opts) {
  const options = opts || {};
  if (options.dry_run === true) {
    return null;
  }
  const file_path = state_file_path();
  if (fs.existsSync(file_path)) {
    return null;
  }
  if (!fs.existsSync(FILE_TRACK_CACHE)) {
    return null;
  }
  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE_TRACK_CACHE, 'utf8'));
  } catch {
    return null;
  }
  const tracks = cache && cache.tracks_by_id ? cache.tracks_by_id : {};
  const ids = Object.keys(tracks);
  let best = null;
  for (let i = 0; i < ids.length; i += 1) {
    const entry = tracks[ids[i]];
    if (!entry || entry.status !== 'rate_limited_429') {
      continue;
    }
    const fetched_at = entry.fetched_at;
    const observed_ms = Date.parse(fetched_at);
    if (!Number.isFinite(observed_ms)) {
      continue;
    }
    const sec = parse_retry_after_seconds_from_message(entry.error_summary);
    if (sec == null) {
      continue;
    }
    if (!best || observed_ms > best.observed_ms) {
      best = {
        observed_ms,
        retry_after_seconds: sec,
        error_summary: entry.error_summary || '',
        track_id: ids[i],
      };
    }
  }
  if (!best) {
    return null;
  }
  return record_track_api_rate_limit(
    {
      observed_at_ms: best.observed_ms,
      retry_after_seconds: best.retry_after_seconds,
      retry_after_inferred: false,
      source: 'backfill:track-metadata-cache.json',
      last_error_summary: best.error_summary,
      historical_event_time_unknown: false,
    },
    { persist_fn: options.persist_fn }
  );
}

/**
 * @param {string} iso_utc
 */
export function format_taiwan_time_from_iso(iso_utc) {
  return format_taiwan_datetime(iso_utc);
}

/**
 * @param {number} ms
 */
export function format_remaining_duration(ms) {
  const total_sec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total_sec / 3600);
  const m = Math.floor((total_sec % 3600) / 60);
  const s = total_sec % 60;
  const parts = [];
  if (h > 0) {
    parts.push(`${h} 小時`);
  }
  if (m > 0) {
    parts.push(`${m} 分`);
  }
  if (s > 0 || parts.length === 0) {
    parts.push(`${s} 秒`);
  }
  return parts.join(' ');
}

function format_cooldown_block_message(state, remaining_ms) {
  return (
    `Spotify Track API 全域冷卻中（HTTP 429）。` +
    `\n冷卻截止：${format_taiwan_time_from_iso(state.retry_not_before)}` +
    `\n建議重新執行：${format_taiwan_retry_time(state.retry_not_before)}` +
    `\n剩餘等待：${format_remaining_duration(remaining_ms)}。`
  );
}

/**
 * 429 停止時於終端機顯示冷卻資訊
 * @param {object} state
 */
export function print_rate_limit_cooldown_notice(state, now_ms = Date.now(), { persisted = true } = {}) {
  if (!state) {
    return;
  }
  const remaining_ms = Date.parse(state.retry_not_before) - now_ms;
  console.error(persisted
    ? '\n[rate-limit] 已記錄 Spotify Track API 429 冷卻狀態。'
    : '\n[rate-limit] Spotify API HTTP 429，請留意以下等待期限。');
  console.error('Retry-After（秒）：', state.retry_after_seconds);
  if (state.retry_after_inferred) {
    console.error('（Retry-After 為推估，非 Spotify 明確指定）');
  }
  console.error('觀測時間：', format_taiwan_time_from_iso(state.observed_at));
  console.error(
    '冷卻截止：',
    format_taiwan_time_from_iso(state.retry_not_before)
  );
  console.error('建議重新執行：', format_taiwan_retry_time(state.retry_not_before));
  if (!Number.isFinite(remaining_ms)) {
    console.error('剩餘等待：未知（無有效截止時間）');
    console.error('');
    return;
  }
  if (remaining_ms > 0) {
    console.error('剩餘等待：', format_remaining_duration(remaining_ms));
  } else {
    console.error('冷卻已過期，可進行小批量恢復測試。');
  }
  console.error('');
}
