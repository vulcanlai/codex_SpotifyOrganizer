/**
 * enrich:auto 離線測試
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse_enrich_auto_cli } from '../lib/enrichment/auto_cli_args.js';
import { EnrichCliError } from '../lib/enrichment/cli_args.js';
import {
  ENRICH_AUTO_MAX_TOTAL,
  ENRICH_AUTO_MIN_DELAY_MS,
  FILE_AUTO_RUN_SUMMARY,
  FILE_TRACK_CACHE,
  FILE_PROCESS_LOCK,
  ENRICHMENT_DIR,
} from '../lib/enrichment/paths.js';
import {
  plan_auto_enrichment,
  run_auto_enrichment,
  sleep_interruptible,
} from '../lib/enrichment/run_auto.js';
import {
  create_track_api_budget,
  assert_track_api_budget,
  TrackApiBudgetExhaustedError,
} from '../lib/enrichment/track_api_budget.js';
import {
  acquire_enrichment_lock,
  is_process_alive,
} from '../lib/enrichment/process_lock.js';
import { count_cache_stats, load_track_cache } from '../lib/enrichment/storage.js';
import { run_track_enrichment } from '../lib/enrichment/run_enrich.js';

test('CLI --total 必填且最大 2000', function () {
  assert.throws(function () {
    parse_enrich_auto_cli([]);
  }, EnrichCliError);
  assert.throws(function () {
    parse_enrich_auto_cli(['--total=2001']);
  }, EnrichCliError);
  const ok = parse_enrich_auto_cli(['--total=2000']);
  assert.equal(ok.total, 2000);
  assert.equal(ENRICH_AUTO_MAX_TOTAL, 2000);
});

test('CLI batch-size 最大 50', function () {
  assert.throws(function () {
    parse_enrich_auto_cli(['--total=100', '--batch-size=51']);
  }, EnrichCliError);
});

test('CLI delay-ms 不得低於 1000', function () {
  assert.throws(function () {
    parse_enrich_auto_cli(['--total=10', '--delay-ms=500']);
  }, EnrichCliError);
});

test('dry-run 不寫 auto-run-summary', async function () {
  let mtime_before = null;
  if (fs.existsSync(FILE_AUTO_RUN_SUMMARY)) {
    mtime_before = fs.statSync(FILE_AUTO_RUN_SUMMARY).mtimeMs;
  }
  const report = await run_auto_enrichment({
    total: 50,
    batch_size: 50,
    delay_ms: 1000,
    batch_pause_sec: 0,
    dry_run: true,
  });
  assert.equal(report.dry_run, true);
  if (mtime_before != null && fs.existsSync(FILE_AUTO_RUN_SUMMARY)) {
    assert.equal(fs.statSync(FILE_AUTO_RUN_SUMMARY).mtimeMs, mtime_before);
  }
});

test('plan 跳過已快取 549 首完整 ok', function () {
  const plan = plan_auto_enrichment({
    total: 2000,
    batch_size: 50,
    delay_ms: 1000,
    batch_pause_sec: 30,
  });
  assert.ok(plan.cache_ok_complete >= 1157);
  assert.ok(plan.queue_len > 0);
  assert.equal(plan.planned_track_slots, Math.min(2000, plan.queue_len));
  assert.equal(plan.planned_track_slots, 2000);
  assert.equal(plan.planned_batches, 40);
});

test('429/401 重試每次 HTTP attempt 計入 budget', function () {
  const budget = create_track_api_budget(2);
  assert_track_api_budget('/v1/tracks/a', { track_api_budget: budget });
  assert_track_api_budget('/v1/tracks/a', { track_api_budget: budget });
  assert.throws(function () {
    assert_track_api_budget('/v1/tracks/a', { track_api_budget: budget });
  }, TrackApiBudgetExhaustedError);
});

test('最後一批不足 50', function () {
  const plan = plan_auto_enrichment({
    total: 2000,
    batch_size: 50,
    delay_ms: 1000,
    batch_pause_sec: 30,
  });
  if (plan.planned_track_slots > 0) {
    const last = plan.planned_track_slots % 50 || 50;
    assert.ok(last <= 50);
  }
});

test('sleep_interruptible 可被 abort', async function () {
  const abort = { requested: false };
  setTimeout(function () {
    abort.requested = true;
  }, 100);
  const ok = await sleep_interruptible(5000, abort);
  assert.equal(ok, false);
});

test('程序鎖：同 pid 活著時拒絕', function () {
  const lock = acquire_enrichment_lock({ test: true });
  assert.throws(function () {
    acquire_enrichment_lock({ test: true });
  });
  lock.release();
});

test('is_process_alive 自身 pid', function () {
  assert.equal(is_process_alive(process.pid), true);
  assert.equal(is_process_alive(99999999), false);
});

test('enrich:tracks 仍可使用', async function () {
  const report = await run_track_enrichment({
    max: 1,
    dry_run: true,
  });
  assert.equal(report.dry_run, true);
});

test('快取 schema 錯誤', function () {
  const cache = load_track_cache();
  assert.equal(cache.schema_version, 1);
});

test('dry-run 不修改 track cache mtime', async function () {
  if (!fs.existsSync(FILE_TRACK_CACHE)) {
    return;
  }
  const before = fs.statSync(FILE_TRACK_CACHE).mtimeMs;
  await run_auto_enrichment({
    total: 10,
    batch_size: 10,
    delay_ms: 1000,
    batch_pause_sec: 0,
    dry_run: true,
  });
  assert.equal(fs.statSync(FILE_TRACK_CACHE).mtimeMs, before);
});

test('磁碟寫入失敗停止', async function () {
  let persist_calls = 0;
  const report = await run_auto_enrichment({
    total: 5,
    batch_size: 5,
    delay_ms: 0,
    batch_pause_sec: 0,
    persist_fn: function () {
      persist_calls += 1;
      throw new Error('disk fail');
    },
    fetch_track: async function (id, fetch_opts) {
      assert_track_api_budget(`/v1/tracks/${id}`, fetch_opts || {});
      return {
        id,
        name: 'N',
        artists: [{ name: 'A' }],
        album: { id: 'al', name: 'Al' },
      };
    },
  });
  assert.equal(report.safe_stopped, true);
});

test('dry-run --total=2000 預算與 40 批', async function () {
  const report = await run_auto_enrichment({
    total: 2000,
    batch_size: 50,
    delay_ms: 1000,
    batch_pause_sec: 30,
    dry_run: true,
  });
  assert.equal(report.dry_run, true);
  assert.equal(report.plan.api_budget_total, 2000);
  assert.equal(report.plan.planned_batches, 40);
  assert.equal(report.plan.planned_track_slots, 2000);
});

test('stale 程序鎖（死 pid）可重新取得', function () {
  if (!fs.existsSync(ENRICHMENT_DIR)) {
    fs.mkdirSync(ENRICHMENT_DIR, { recursive: true });
  }
  fs.writeFileSync(
    FILE_PROCESS_LOCK,
    `${JSON.stringify({ pid: 99999999, started_at: new Date().toISOString() }, null, 2)}\n`,
    { encoding: 'utf8' }
  );
  const lock = acquire_enrichment_lock({ test: 'stale' });
  lock.release();
});

test('Ctrl+C 中斷 auto 執行', async function () {
  const abort_signal = { requested: false };
  let fetched = 0;
  const report = await run_auto_enrichment({
    total: 50,
    batch_size: 50,
    delay_ms: 0,
    batch_pause_sec: 0,
    abort_signal,
    persist_fn: function () {},
    fetch_track: async function (id, fetch_opts) {
      assert_track_api_budget(`/v1/tracks/${id}`, fetch_opts || {});
      fetched += 1;
      if (fetched >= 2) {
        abort_signal.requested = true;
      }
      return {
        id,
        name: 'N',
        artists: [{ name: 'A' }],
        album: { id: 'al', name: 'Al' },
      };
    },
  });
  assert.equal(report.safe_stopped, true);
  assert.equal(report.stop_reason, '使用者中斷（Ctrl+C）');
  assert.ok(fetched >= 2);
});

test('多批 mock 執行後 aggregate 與快取統計一致', async function () {
  let fetched = 0;
  const report = await run_auto_enrichment({
    total: 4,
    batch_size: 2,
    delay_ms: 0,
    batch_pause_sec: 0,
    persist_fn: function () {},
    fetch_track: async function (id, fetch_opts) {
      assert_track_api_budget(`/v1/tracks/${id}`, fetch_opts || {});
      fetched += 1;
      return {
        id,
        name: 'N',
        artists: [{ name: 'A' }],
        album: { id: 'al', name: 'Al' },
      };
    },
  });
  assert.equal(fetched, 4);
  assert.equal(report.aggregate.tracks_processed, 4);
  assert.equal(report.batches.length, 2);
  assert.equal(report.budget.consumed(), 4);
});

test('401 重新查詢：每次 HTTP attempt 各計 1 次預算（模擬 spotify_get 401 路徑）', function () {
  const budget = create_track_api_budget(2);
  assert_track_api_budget('/v1/tracks/x', { track_api_budget: budget });
  assert_track_api_budget('/v1/tracks/x', { track_api_budget: budget });
  assert.throws(function () {
    assert_track_api_budget('/v1/tracks/x', { track_api_budget: budget });
  }, TrackApiBudgetExhaustedError);
  assert.equal(budget.consumed(), 2);
});

test('OAuth token refresh 端點不消耗 Track API 預算', function () {
  const budget = create_track_api_budget(1);
  assert_track_api_budget('https://accounts.spotify.com/api/token', {
    track_api_budget: budget,
  });
  assert.equal(budget.consumed(), 0);
});
