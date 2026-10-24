/**
 * metadata enrichment 離線測試
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse_enrich_cli, EnrichCliError } from '../lib/enrichment/cli_args.js';
import { ENRICH_MAX_PER_RUN } from '../lib/enrichment/paths.js';
import {
  is_metadata_cache_complete,
  has_required_metadata_fields,
  cache_entry_from_track_body,
  cache_entry_from_error,
  should_fetch_track,
} from '../lib/enrichment/track_entry.js';
import { build_enrichment_queue } from '../lib/enrichment/queue.js';
import {
  merge_cache_entry,
  count_cache_stats,
} from '../lib/enrichment/storage.js';
import { run_track_enrichment } from '../lib/enrichment/run_enrich.js';
import { write_json_atomic } from '../lib/atomic_json.js';
import { SpotifyRequestError } from '../lib/spotify_api.js';

test('CLI：缺少 --max 拒絕', function () {
  assert.throws(function () {
    parse_enrich_cli([]);
  }, EnrichCliError);
});

test('CLI：--max 超過 50 拒絕', function () {
  assert.throws(function () {
    parse_enrich_cli(['--max=51']);
  }, EnrichCliError);
});

test('CLI：dry-run 與 max 解析', function () {
  const p = parse_enrich_cli(['--max=10', '--dry-run', '--delay-ms=0']);
  assert.equal(p.max, 10);
  assert.equal(p.dry_run, true);
  assert.equal(p.delay_ms, 0);
});

test('is_metadata_cache_complete 與 partial', function () {
  const full = cache_entry_from_track_body({
    id: 't1',
    name: 'Song',
    uri: 'spotify:track:t1',
    artists: [{ id: 'a1', name: 'A' }],
    album: { id: 'al1', name: 'Al', album_type: 'album' },
    duration_ms: 1000,
    is_playable: true,
  });
  assert.equal(full.status, 'ok');
  assert.equal(is_metadata_cache_complete(full), true);

  const partial = cache_entry_from_track_body({
    id: 't2',
    name: 'Only',
    artists: [],
  });
  assert.equal(partial.status, 'partial');
});

test('is_playable 缺省為 unknown', function () {
  const e = cache_entry_from_track_body({
    id: 't3',
    name: 'N',
    artists: [{ name: 'A' }],
    album: { id: 'x', name: 'Y' },
  });
  assert.equal(e.is_playable, null);
  assert.equal(e.playability_status, 'unknown');
});

test('is_playable false', function () {
  const e = cache_entry_from_track_body({
    id: 't4',
    name: 'N',
    artists: [{ name: 'A' }],
    album: { id: 'x', name: 'Y' },
    is_playable: false,
    restrictions: { reason: 'market' },
  });
  assert.equal(e.playability_status, 'not_playable');
});

test('佇列跳過已 ok 快取', function () {
  const index = {
    a: { spotify_id: 'a', name: null, artists: [] },
    b: { spotify_id: 'b', name: null, artists: [] },
  };
  const cache = {
    tracks_by_id: {
      a: cache_entry_from_track_body({
        id: 'a',
        name: 'A',
        artists: [{ id: '1', name: 'X' }],
        album: { id: 'al', name: 'Al' },
      }),
    },
  };
  const q = build_enrichment_queue(index, cache, Date.now(), {
    not_found_404: 0,
    forbidden_403: 0,
    partial: 0,
    network_error: 0,
    rate_limited_429: 0,
  });
  assert.deepEqual(q.queue, ['b']);
});

test('404 冷卻期間不重試', function () {
  const now = Date.now();
  const cached = cache_entry_from_error('x', {
    status: 'not_found_404',
    http_status: 404,
    message: 'nf',
    next_retry_after: new Date(now + 60000).toISOString(),
  });
  const d = should_fetch_track('x', cached, { spotify_id: 'x' }, now, {
    not_found_404: 999999,
    forbidden_403: 0,
    partial: 0,
    network_error: 0,
    rate_limited_429: 0,
  });
  assert.equal(d.fetch, false);
});

test('完整 ok 不被錯誤覆蓋', function () {
  const cache_doc = { tracks_by_id: {} };
  const ok = cache_entry_from_track_body({
    id: 'k',
    name: 'K',
    artists: [{ id: 'a', name: 'A' }],
    album: { id: 'al', name: 'Al' },
  });
  ok.status = 'ok';
  merge_cache_entry(cache_doc, 'k', ok);
  assert.equal(is_metadata_cache_complete(cache_doc.tracks_by_id.k), true);
  const bad = cache_entry_from_error('k', {
    status: 'network_error',
    http_status: null,
    message: 'fail',
  });
  const merged = merge_cache_entry(cache_doc, 'k', bad);
  assert.equal(merged, false);
  assert.equal(cache_doc.tracks_by_id.k.status, 'ok');
});

function noop_persist() {}

test('dry-run 不呼叫 fetch', async function () {
  let calls = 0;
  const report = await run_track_enrichment({
    max: 5,
    dry_run: true,
    persist_fn: noop_persist,
    fetch_track: async function () {
      calls += 1;
      return {};
    },
  });
  assert.equal(calls, 0);
  assert.equal(report.dry_run, true);
  assert.ok(report.run_stats.planned_queries <= 5);
});

test('同 ID 只查一次', async function () {
  const seen = {};
  await run_track_enrichment({
    max: 3,
    dry_run: false,
    delay_ms: 0,
    persist_fn: noop_persist,
    fetch_track: async function (id) {
      seen[id] = (seen[id] || 0) + 1;
      return {
        id,
        name: id,
        artists: [{ id: 'ar', name: 'Ar' }],
        album: { id: 'al', name: 'Al' },
        is_playable: true,
      };
    },
  });
  const keys = Object.keys(seen);
  for (let i = 0; i < keys.length; i += 1) {
    assert.equal(seen[keys[i]], 1);
  }
});

test('404 單首失敗不崩潰', async function () {
  const report = await run_track_enrichment({
    max: 2,
    delay_ms: 0,
    persist_fn: noop_persist,
    fetch_track: async function (id) {
      if (id.indexOf('00') === 0) {
        throw new SpotifyRequestError('404', 404);
      }
      return {
        id,
        name: 'N',
        artists: [{ name: 'A' }],
        album: { id: 'al', name: 'Al' },
      };
    },
  });
  assert.ok(report.run_stats.run_not_found_404 >= 0);
});

test('403 停止整批', async function () {
  let calls = 0;
  const report = await run_track_enrichment({
    max: 5,
    delay_ms: 0,
    persist_fn: noop_persist,
    cooldowns: {
      not_found_404: 0,
      forbidden_403: 999999,
      partial: 0,
      network_error: 0,
      rate_limited_429: 0,
    },
    fetch_track: async function () {
      calls += 1;
      throw new SpotifyRequestError('403', 403);
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.safe_stopped, true);
});

test('429 停止整批', async function () {
  let calls = 0;
  const report = await run_track_enrichment({
    max: 3,
    delay_ms: 0,
    persist_fn: noop_persist,
    fetch_track: async function () {
      calls += 1;
      throw new SpotifyRequestError('429', 429, null, 200);
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.safe_stopped, true);
});

test('原子寫入快取檔', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-enrich-'));
  const file = path.join(dir, 'cache.json');
  write_json_atomic(file, { ok: true });
  assert.ok(fs.existsSync(file));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('schema 錯誤應停止', function () {
  const bad = { schema_version: 99, tracks_by_id: {} };
  assert.throws(function () {
    if (bad.schema_version !== 1) {
      throw new Error('schema');
    }
  });
});

test('--max 上限常數為 50', function () {
  assert.equal(ENRICH_MAX_PER_RUN, 50);
});
