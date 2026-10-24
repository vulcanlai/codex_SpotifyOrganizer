/**
 * Track API 全域 429 冷卻狀態
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parse_retry_after_header,
  compute_retry_not_before_iso,
  record_track_api_rate_limit,
  read_rate_limit_state_doc,
  get_active_rate_limit_state,
  assert_track_api_not_globally_rate_limited,
  assert_cli_may_query_track_api,
  try_backfill_rate_limit_state_from_cache,
  validate_rate_limit_state_doc,
  GlobalRateLimitCooldownError,
  GlobalRateLimitStateError,
  set_test_rate_limit_state_path,
  reset_test_rate_limit_state_path,
  RATE_LIMIT_STATE_SCHEMA_VERSION,
} from '../lib/enrichment/rate_limit_state.js';
import { fetch_track_catalog, SpotifyRequestError } from '../lib/spotify_api.js';
import { run_auto_enrichment } from '../lib/enrichment/run_auto.js';
import { run_track_enrichment } from '../lib/enrichment/run_enrich.js';
import { FILE_TRACK_CACHE, FILE_CHECKPOINT } from '../lib/enrichment/paths.js';

let tmp_dir = null;
let current_temp_state_file = null;

function use_temp_state_file() {
  if (!tmp_dir) {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rate-limit-'));
  }
  current_temp_state_file = path.join(tmp_dir, 'rate-limit-state.json');
  set_test_rate_limit_state_path(current_temp_state_file);
}

function clear_temp_state() {
  if (current_temp_state_file && fs.existsSync(current_temp_state_file)) {
    fs.unlinkSync(current_temp_state_file);
  }
  current_temp_state_file = null;
  reset_test_rate_limit_state_path();
}

afterEach(function () {
  clear_temp_state();
});

test('Retry-After 秒數解析', function () {
  const r = parse_retry_after_header('120', Date.parse('2026-01-01T00:00:00.000Z'));
  assert.equal(r.retry_after_seconds, 120);
  assert.equal(r.retry_after_inferred, false);
});

test('Retry-After HTTP-date 解析', function () {
  const now = Date.parse('2026-01-01T00:00:00.000Z');
  const r = parse_retry_after_header('Wed, 01 Jan 2026 01:00:00 GMT', now);
  assert.equal(r.retry_after_seconds, 3600);
  assert.equal(r.retry_after_inferred, false);
});

test('429 截止時間以觀測時間計算', function () {
  const observed = Date.parse('2026-10-20T00:43:05.525Z');
  const iso = compute_retry_not_before_iso(observed, 50846);
  assert.equal(iso, '2026-10-20T14:50:31.525Z');
});

test('重啟不延長冷卻：retry_not_before 固定', function () {
  use_temp_state_file();
  const observed = Date.parse('2026-10-20T00:43:05.525Z');
  record_track_api_rate_limit({
    observed_at_ms: observed,
    retry_after_seconds: 100,
    source: 'test',
    last_error_summary: '429',
  });
  const later = get_active_rate_limit_state(observed + 1000);
  assert.ok(later);
  assert.equal(later.retry_not_before, '2026-10-20T00:44:45.525Z');
  const expired = get_active_rate_limit_state(observed + 100 * 1000 + 1);
  assert.equal(expired, null);
});

test('冷卻期間 auto API 層拒絕且不呼叫 fetch', async function () {
  use_temp_state_file();
  const observed = Date.now();
  record_track_api_rate_limit({
    observed_at_ms: observed,
    retry_after_seconds: 3600,
    source: 'test',
    last_error_summary: '429',
  });
  let fetch_calls = 0;
  const orig_fetch = globalThis.fetch;
  globalThis.fetch = async function () {
    fetch_calls += 1;
    return orig_fetch.apply(this, arguments);
  };
  try {
    await assert.rejects(function () {
      return fetch_track_catalog('abc123');
    }, GlobalRateLimitCooldownError);
  } finally {
    globalThis.fetch = orig_fetch;
  }
  assert.equal(fetch_calls, 0);
});

test('冷卻期間 assert_cli 拒絕 enrich:auto', function () {
  use_temp_state_file();
  record_track_api_rate_limit({
    observed_at_ms: Date.now(),
    retry_after_seconds: 600,
    source: 'test',
    last_error_summary: '429',
  });
  assert.throws(function () {
    assert_cli_may_query_track_api('enrich:auto', { dry_run: false });
  }, GlobalRateLimitCooldownError);
});

test('冷卻期間 tracks CLI 拒絕', function () {
  use_temp_state_file();
  record_track_api_rate_limit({
    observed_at_ms: Date.now(),
    retry_after_seconds: 600,
    source: 'test',
    last_error_summary: '429',
  });
  assert.throws(function () {
    assert_cli_may_query_track_api('enrich:tracks', { dry_run: false });
  }, GlobalRateLimitCooldownError);
});

test('冷卻期間 probe CLI 拒絕', function () {
  use_temp_state_file();
  record_track_api_rate_limit({
    observed_at_ms: Date.now(),
    retry_after_seconds: 600,
    source: 'test',
    last_error_summary: '429',
  });
  assert.throws(function () {
    assert_cli_may_query_track_api('probe:tracks', { dry_run: false });
  }, GlobalRateLimitCooldownError);
});

test('dry-run 不受 CLI 冷卻阻擋', function () {
  use_temp_state_file();
  record_track_api_rate_limit({
    observed_at_ms: Date.now(),
    retry_after_seconds: 600,
    source: 'test',
    last_error_summary: '429',
  });
  assert_cli_may_query_track_api('enrich:auto', { dry_run: true });
});

test('冷卻過期後允許查詢', function () {
  use_temp_state_file();
  const observed = Date.now() - 5000;
  record_track_api_rate_limit({
    observed_at_ms: observed,
    retry_after_seconds: 1,
    source: 'test',
    last_error_summary: '429',
  });
  assert.doesNotThrow(function () {
    assert_track_api_not_globally_rate_limited({ now_ms: Date.now() });
  });
});

test('再次 429 更新冷卻截止時間', function () {
  use_temp_state_file();
  record_track_api_rate_limit({
    observed_at_ms: Date.parse('2026-01-01T00:00:00.000Z'),
    retry_after_seconds: 10,
    source: 'first',
    last_error_summary: '429',
  });
  record_track_api_rate_limit({
    observed_at_ms: Date.parse('2026-01-01T00:05:00.000Z'),
    retry_after_seconds: 20,
    source: 'second',
    last_error_summary: '429 again',
  });
  const doc = read_rate_limit_state_doc();
  assert.equal(doc.observed_at, '2026-01-01T00:05:00.000Z');
  assert.equal(doc.retry_not_before, '2026-01-01T00:05:20.000Z');
  assert.equal(doc.source, 'second');
});

test('冷卻狀態檔損毀 fail-closed', function () {
  use_temp_state_file();
  fs.writeFileSync(current_temp_state_file, '{ bad json', 'utf8');
  assert.throws(function () {
    read_rate_limit_state_doc();
  }, GlobalRateLimitStateError);
});

test('冷卻狀態寫入失敗安全停止', function () {
  use_temp_state_file();
  assert.throws(function () {
    record_track_api_rate_limit(
      {
        observed_at_ms: Date.now(),
        retry_after_seconds: 10,
        source: 'test',
        last_error_summary: '429',
      },
      {
        persist_fn: function () {
          throw new Error('disk full');
        },
      }
    );
  }, /disk full/);
});

test('429 停止 auto 且保留已處理進度', async function () {
  use_temp_state_file();
  let n = 0;
  const report = await run_auto_enrichment({
    total: 5,
    batch_size: 5,
    delay_ms: 0,
    batch_pause_sec: 0,
    persist_fn: function () {},
    fetch_track: async function (id, fetch_opts) {
      n += 1;
      if (n === 1) {
        return {
          id,
          name: 'OK',
          artists: [{ name: 'A' }],
          album: { id: 'al', name: 'Al' },
        };
      }
      throw new SpotifyRequestError('429', 429, null, 50846);
    },
  });
  assert.equal(report.safe_stopped, true);
  assert.equal(report.aggregate.run_success_ok, 1);
  assert.equal(fs.existsSync(current_temp_state_file), false);
});

test('Track API 429 立即寫入冷卻狀態（record 層）', function () {
  use_temp_state_file();
  const doc = record_track_api_rate_limit({
    observed_at_ms: Date.parse('2026-10-20T00:43:05.525Z'),
    retry_after_seconds: 50846,
    source: 'test:spotify_get',
    last_error_summary: '429 test',
  });
  assert.equal(doc.retry_after_seconds, 50846);
  assert.equal(doc.http_status, 429);
  assert.equal(read_rate_limit_state_doc().retry_not_before, doc.retry_not_before);
});

test('dry-run auto 不寫 rate-limit 與 cache', async function () {
  use_temp_state_file();
  assert.ok(current_temp_state_file);
  const cache_before = fs.existsSync(FILE_TRACK_CACHE)
    ? fs.statSync(FILE_TRACK_CACHE).mtimeMs
    : null;
  await run_auto_enrichment({
    total: 10,
    dry_run: true,
    batch_size: 10,
    delay_ms: 1000,
    batch_pause_sec: 0,
  });
  assert.equal(fs.existsSync(current_temp_state_file), false);
  if (cache_before != null) {
    assert.equal(fs.statSync(FILE_TRACK_CACHE).mtimeMs, cache_before);
  }
});

test('冷卻期間 enrich:tracks dry-run 不修改 checkpoint', async function () {
  use_temp_state_file();
  record_track_api_rate_limit({
    observed_at_ms: Date.now(),
    retry_after_seconds: 600,
    source: 'test',
    last_error_summary: '429',
  });
  const cp_before = fs.statSync(FILE_CHECKPOINT).mtimeMs;
  await run_track_enrichment({ max: 1, dry_run: true });
  assert.equal(fs.statSync(FILE_CHECKPOINT).mtimeMs, cp_before);
});

test('enrich:tracks 與 auto 功能仍可用（dry-run）', async function () {
  const a = await run_auto_enrichment({
    total: 5,
    dry_run: true,
    batch_size: 5,
    delay_ms: 1000,
    batch_pause_sec: 0,
  });
  assert.equal(a.dry_run, true);
  const t = await run_track_enrichment({ max: 1, dry_run: true });
  assert.equal(t.dry_run, true);
});

test('schema 驗證：retry_not_before 不一致拒絕', function () {
  assert.throws(function () {
    validate_rate_limit_state_doc({
      schema_version: RATE_LIMIT_STATE_SCHEMA_VERSION,
      http_status: 429,
      retry_after_seconds: 10,
      observed_at: '2026-01-01T00:00:00.000Z',
      retry_not_before: '2026-01-01T00:00:05.000Z',
      source: 'x',
      last_error_summary: '',
    });
  }, GlobalRateLimitStateError);
});

test('backfill 不覆寫既有狀態檔', function () {
  use_temp_state_file();
  record_track_api_rate_limit({
    observed_at_ms: Date.now(),
    retry_after_seconds: 99,
    source: 'existing',
    last_error_summary: '429',
  });
  const before = read_rate_limit_state_doc();
  try_backfill_rate_limit_state_from_cache({ dry_run: false });
  const after = read_rate_limit_state_doc();
  assert.equal(after.source, before.source);
  assert.equal(after.retry_after_seconds, 99);
});
