import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build_enrichment_status, format_enrichment_status, build_api_cooldown_status } from '../lib/enrichment/status.js';

function cooldown_record(deadline, extra = {}) {
  const until = Date.parse(deadline);
  return {
    schema_version: 1, http_status: 429, retry_after_seconds: 120,
    observed_at: new Date(until - 120000).toISOString(),
    retry_not_before: new Date(until).toISOString(),
    source: 'offline-test', last_error_summary: 'simulated 429',
    retry_after_inferred: false, historical_event_time_unknown: false, ...extra,
  };
}

function report_with_cooldown(state, now) {
  return format_enrichment_status({
    ...build_enrichment_status({}, { ...cache(), updated_at: '2026-11-02T01:32:19.791Z' }, now),
    api_cooldown: build_api_cooldown_status(state, now),
  });
}

const root = fileURLToPath(new URL('../', import.meta.url));
const complete = (playability_status) => ({
  status: 'ok', name: 'Song', artists: [{ name: 'Artist' }],
  album: { name: 'Album' }, playability_status,
});
const cache = (tracks_by_id = {}) => ({ schema_version: 1, updated_at: null, tracks_by_id });

test('API 冷卻進行中、已結束與精確截止邊界，獨立於快取更新時間及歌曲異常', () => {
  const state = cooldown_record('2026-11-02T15:32:13.770Z');
  const now = Date.parse('2026-11-02T15:30:13.770Z');
  const active = report_with_cooldown(state, now);
  assert.match(active, /目前是否冷卻中：是/);
  assert.match(active, /冷卻截止時間：2026\/11\/02 23:32:13（台灣時間）/);
  assert.match(active, /建議重新執行時間：2026\/11\/02 23:33:00（台灣時間）/);
  assert.match(active, /尚需等待：2 分/);
  assert.match(active, /快取最後更新時間：2026\/11\/02 09:32:19（台灣時間）/);
  assert.match(active, /異常未完成：0/);
  for (const time of [Date.parse(state.retry_not_before), now + 121000]) {
    const expired = report_with_cooldown(state, time);
    assert.match(expired, /目前是否冷卻中：否/);
    assert.match(expired, /尚需等待：0 秒/);
    assert.match(expired, /冷卻已結束，可以重新嘗試執行/);
  }
});

test('缺少、錯誤或推估冷卻資料皆顯示未知，不使用快取時間推算', () => {
  const now = Date.parse('2026-11-02T15:30:13Z');
  for (const state of [null, {}, [], { ...cooldown_record('2026-11-02T15:32:13Z'), retry_after_seconds: 10 },
    cooldown_record('2026-11-02T15:32:13Z', { retry_after_inferred: true }),
    cooldown_record('2026-11-02T15:32:13Z', { historical_event_time_unknown: true })]) {
    const output = report_with_cooldown(state, now);
    assert.match(output, /目前是否冷卻中：未知/);
    assert.match(output, /冷卻截止時間：未知/);
    assert.match(output, /建議重新執行時間：未知/);
    assert.match(output, /尚需等待：未知/);
    assert.doesNotMatch(output, /可以重新嘗試/);
  }
  assert.match(report_with_cooldown(null, now), /無有效冷卻紀錄/);
});

for (const [deadline, next] of [
  ['2026-11-02T15:59:59.999Z', '2026/11/03 00:00:00'],
  ['2026-11-30T15:59:59.999Z', '2026/12/01 00:00:00'],
  ['2026-12-31T15:59:59.999Z', '2027/01/01 00:00:00'],
  ['2026-11-02T15:32:00.000Z', '2026/11/02 23:32:00'],
]) {
  test(`狀態查詢跨日／月／年及整分鐘：${deadline}`, () => {
    const output = report_with_cooldown(cooldown_record(deadline), Date.parse(deadline) - 1000);
    assert.ok(output.includes(`建議重新執行時間：${next}（台灣時間）`));
  });
}

test('V2 與成功快取依 ID 去重、衝突優先序及所有播放分類', () => {
  const index = {
    a: { spotify_id: 'a', name: 'V2', playability_status: 'playable' },
    b: { spotify_id: 'b', playability_status: 'not_playable' },
    c: { spotify_id: 'c', name: 'V2', playability_status: 'restricted' },
    d: { spotify_id: 'd', name: 'V2', playability_status: 'unknown', is_playable: true },
    e: { spotify_id: 'e', name: 'V2', playability_status: null },
    f: { spotify_id: 'f', name: 'V2' },
    g: { spotify_id: 'g', name: 'V2', playability_status: 'not_playable' },
  };
  const doc = cache({ a: complete('restricted'), b: complete('playable'),
    c: complete('unknown'), g: complete(null), outside: complete('playable') });
  const before = JSON.stringify({ index, doc });
  const s = build_enrichment_status(index, doc);
  assert.equal(s.total, 7);
  assert.equal(s.completed, 7);
  assert.equal(s.completion_percent, 100);
  assert.equal(s.remaining_total, 0);
  assert.deepEqual(s.playback, { playable: 1, not_playable: 3, unknown: 3 });
  assert.equal(s.cache.cache_ok_complete, 5);
  assert.equal(s.cache.cached_entries, 5);
  assert.equal(JSON.stringify({ index, doc }), before);
});

test('403/404/429/network/partial、冷卻與正常階段延後；總數核對', () => {
  const statuses = ['forbidden_403', 'not_found_404', 'rate_limited_429', 'network_error', 'partial', 'other'];
  const index = { normal: { spotify_id: 'normal' }, done: { spotify_id: 'done' } };
  const doc = cache({ done: complete('not_playable') });
  statuses.forEach((status, n) => {
    const id = `error${n}`;
    index[id] = { spotify_id: id };
    doc.tracks_by_id[id] = { status, fetched_at: '2026-01-01T00:00:00Z' };
  });
  doc.tracks_by_id.error5.next_retry_after = '2026-01-02T00:00:00Z';
  const s = build_enrichment_status(index, doc, Date.parse('2026-01-01T00:00:01Z'));
  assert.equal(s.completed, 1);
  assert.equal(s.normal_pending, 1);
  assert.equal(s.anomalous_pending, 6);
  assert.equal(s.deferred_anomalies, 6);
  assert.equal(s.cooldown_anomalies, 6);
  assert.equal(s.remaining_total, 7);
  assert.equal(s.total, s.completed + s.normal_pending + s.anomalous_pending);
  assert.equal(s.total, Object.values(s.playback).reduce((a, b) => a + b, 0));
  for (const key of ['cache_forbidden_403', 'cache_not_found_404', 'cache_rate_limited_429',
    'cache_network_error', 'cache_partial', 'cache_other', 'cache_ok_complete']) {
    assert.equal(s.cache[key], 1);
  }
  assert.equal(s.cache.cached_entries, 7);
  assert.equal(build_enrichment_status(index, doc, Date.parse('2026-02-01')).cooldown_anomalies, 0);
});

test('空資料顯示零與未知時間；沿用 V2 部分 Metadata 既有口徑', () => {
  const s = build_enrichment_status({}, cache());
  assert.equal(s.total, 0);
  assert.equal(s.completion_percent, 0);
  assert.match(format_enrichment_status(s), /完成率：0\.00%/);
  assert.match(format_enrichment_status(s), /未知（未記錄）/);
  assert.equal(build_enrichment_status({ a: { name: 'Only name' } }, cache()).completed, 1);
});

test('拒絕錯誤索引、無效列與不一致 ID', () => {
  for (const index of [null, [], { a: null }, { a: [] }, { a: { spotify_id: 'b' } }]) {
    assert.throws(() => build_enrichment_status(index, cache()), /物件|無效/);
  }
  for (const tracks of [null, [], { a: null }]) {
    assert.throws(() => build_enrichment_status({}, cache(tracks)), /物件|無效/);
  }
});

function snapshot(dir) {
  const out = {};
  function walk(base) {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const p = path.join(base, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        const stat = fs.statSync(p);
        out[path.relative(dir, p)] = [stat.mtimeMs, stat.size,
          crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')];
      }
    }
  }
  walk(dir);
  return out;
}

test('隔離 CLI 成功、空資料及缺檔／格式錯誤均不改寫任何檔案、不連網', () => {
  const temp = fs.mkdtempSync(path.join(root, '.spotify-status-test-'));
  try {
    function copy_tree(source, target) {
      fs.mkdirSync(target, { recursive: true });
      for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        if (entry.isDirectory()) copy_tree(path.join(source, entry.name), path.join(target, entry.name));
        else if (entry.isFile()) fs.copyFileSync(path.join(source, entry.name), path.join(target, entry.name));
      }
    }
    copy_tree(path.join(root, 'lib'), path.join(temp, 'lib'));
    fs.copyFileSync(path.join(root, 'enrich-status.js'), path.join(temp, 'enrich-status.js'));
    fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
    const merged = path.join(temp, 'backup', 'merged');
    const enrichment = path.join(temp, 'backup', 'enrichment');
    fs.mkdirSync(merged, { recursive: true });
    fs.mkdirSync(enrichment, { recursive: true });
    for (const p of ['checkpoint.json', 'summary.json', 'auto-run-summary.json', 'rate-limit-state.json']) {
      fs.writeFileSync(path.join(enrichment, p), '{"sentinel":true}');
    }
    fs.writeFileSync(path.join(temp, '.spotify_tokens.json'), '{"sentinel":"fake-token"}');
    fs.writeFileSync(path.join(temp, 'offline.cjs'), `
      const deny = () => { throw new Error('Unexpected network or OAuth'); };
      globalThis.fetch = deny;
      require('node:http').request = deny; require('node:https').request = deny;
      require('node:http').get = deny; require('node:https').get = deny;
      require('node:net').Socket.prototype.connect = deny;
      require('node:child_process').spawn = deny;
      require('node:child_process').exec = deny;
      Date.now = () => Date.parse('2026-11-02T15:30:13Z');
      if (process.env.SPOTIFY_STATUS_TEST_DENY_RATE_READ === '1') {
        const fs = require('node:fs');
        const read = fs.readFileSync;
        fs.readFileSync = function (p, ...args) {
          if (String(p).endsWith('rate-limit-state.json')) throw new Error('EACCES simulated read denial');
          return read.call(this, p, ...args);
        };
      }
    `);
    const library = path.join(merged, 'library-v2.json');
    const summary = path.join(merged, 'merge-summary-v2.json');
    const cached = path.join(enrichment, 'track-metadata-cache.json');
    const rate_limit = path.join(enrichment, 'rate-limit-state.json');
    const write = (p, doc) => fs.writeFileSync(p, JSON.stringify(doc));
    const reset = () => {
      write(library, { schema_version: 2, track_index_by_spotify_id: {} });
      write(summary, { library_v2_merge_complete: true });
      write(cached, cache());
    };
    const run = (ok, pattern, extra_env = {}) => {
      const before = snapshot(temp);
      const child = spawnSync(process.execPath, ['--require', path.join(temp, 'offline.cjs'), 'enrich-status.js'],
        { cwd: temp, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', ...extra_env } });
      assert.equal(child.status, ok ? 0 : 1, child.stderr);
      assert.match(child.stdout + child.stderr, pattern);
      assert.deepEqual(snapshot(temp), before);
    };
    reset();
    run(true, /音樂庫歌曲總數（Spotify ID 去重）：0/);
    fs.unlinkSync(rate_limit);
    run(true, /無有效冷卻紀錄/);
    write(rate_limit, cooldown_record('2026-11-02T15:32:13Z'));
    run(true, /目前是否冷卻中：是/);
    run(true, /無法讀取或驗證冷卻紀錄.*EACCES/, { SPOTIFY_STATUS_TEST_DENY_RATE_READ: '1' });
    write(rate_limit, cooldown_record('2026-11-02T15:00:00Z'));
    run(true, /冷卻已結束，可以重新嘗試執行/);
    for (const value of ['{broken', 'null', '[]', '{"schema_version":99}']) {
      fs.writeFileSync(rate_limit, value);
      run(true, /目前是否冷卻中：未知/);
    }
    write(library, { schema_version: 2, track_index_by_spotify_id: { a: { spotify_id: 'a' } } });
    write(cached, cache({ a: complete('restricted') }));
    run(true, /已知不可播放／受限：1/);
    for (const file of [library, summary, cached]) {
      reset(); fs.unlinkSync(file); run(false, /缺少/);
      reset(); fs.writeFileSync(file, '{broken'); run(false, /無法查詢歌曲補全狀態/);
      reset(); fs.writeFileSync(file, 'null'); run(false, /無法查詢歌曲補全狀態/);
    }
    for (const doc of [cache([]), cache({ a: null }), { ...cache(), schema_version: 99 },
      { ...cache(), updated_at: 'invalid-date' }]) {
      reset(); write(cached, doc); run(false, /無法查詢歌曲補全狀態/);
    }
  } finally {
    assert.equal(path.dirname(temp), path.resolve(root));
    assert.ok(path.basename(temp).startsWith('.spotify-status-test-'));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
