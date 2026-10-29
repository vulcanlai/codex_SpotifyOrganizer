import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { build_enrichment_queue } from '../lib/enrichment/queue.js';
import { parse_enrich_auto_cli } from '../lib/enrichment/auto_cli_args.js';
import { run_auto_enrichment } from '../lib/enrichment/run_auto.js';
import { SpotifyRequestError } from '../lib/spotify_api.js';
import { assert_track_api_budget } from '../lib/enrichment/track_api_budget.js';

// 所有資料與保存皆在記憶體中；若誤走真實 API 路徑立即使測試失敗。
beforeEach(t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('禁止測試連線'); });
});
const statuses = ['partial', 'not_found_404', 'forbidden_403',
  'rate_limited_429', 'network_error', 'other_error'];
const full = id => ({ id, name: 'Song', artists: [{ name: 'Artist' }], album: { id: 'album' } });
const old = status => ({ status, fetched_at: '2020-01-01T00:00:00.000Z' });

function fixture(ids, entries = {}) {
  const state = {
    track_index: Object.fromEntries(ids.map(id => [id, { spotify_id: id, name: null, artists: [] }])),
    cache_doc: { schema_version: 1, tracks_by_id: structuredClone(entries) },
    checkpoint_doc: { schema_version: 1, last_track_id_processed: 'previous', custom: 'preserve' },
  };
  const calls = [];
  const saved = [];
  const summaries = [];
  const options = {
    state, total: 20, batch_size: 1, delay_ms: 0, batch_pause_sec: 0,
    persist_fn: doc => saved.push(structuredClone(doc)),
    write_auto_summary_fn: doc => summaries.push(structuredClone(doc)),
    fetch_track: async (id, opts) => {
      calls.push(id);
      assert_track_api_budget(`/v1/tracks/${id}`, opts);
      return full(id);
    },
  };
  return { state, calls, saved, summaries, options };
}

test('CLI 明確切換 --retry-failed，保留 --resume 與 dry-run', () => {
  assert.equal(parse_enrich_auto_cli(['--total=10', '--resume']).retry_failed, false);
  const cli = parse_enrich_auto_cli(['--total=10', '--resume', '--retry-failed', '--dry-run']);
  assert.equal(cli.retry_failed, true);
  assert.equal(cli.resume, true);
  assert.equal(cli.dry_run, true);
});

test('預設隔離所有既有非完整快取；正常與異常階段不互相混入', async () => {
  const entries = Object.fromEntries(statuses.map((s, i) => [`a${i}`, old(s)]));
  const f = fixture([...Object.keys(entries), 'z'], entries);
  const before = structuredClone(f.state.cache_doc.tracks_by_id);
  const normal = await run_auto_enrichment(f.options);
  assert.deepEqual(f.calls, ['z']);
  for (const id of Object.keys(entries)) assert.deepEqual(f.state.cache_doc.tracks_by_id[id], before[id]);
  assert.equal(normal.progress.normal_pending, 0);
  assert.equal(normal.progress.deferred_anomalies, 6);
  assert.equal(normal.progress.remaining_total, 6);
  assert.equal(normal.can_resume, true);
  assert.equal(normal.progress.run_success, 1);
  assert.equal(normal.progress.run_failed, 0);
  f.calls.length = 0;
  const retry = await run_auto_enrichment({ ...f.options, retry_failed: true });
  assert.deepEqual(f.calls, Object.keys(entries));
  assert.equal(retry.progress.phase, 'retry');
  assert.equal(retry.progress.remaining_total, 0);
  assert.equal(retry.can_resume, false);
  assert.equal(f.state.checkpoint_doc.custom, 'preserve');
  assert.equal(f.state.cache_doc.schema_version, 1);
  assert.deepEqual(f.summaries.at(-1).progress, retry.progress);
  assert.deepEqual(f.saved.at(-1).summary_doc.progress, retry.progress);
});

test('異常重試階段只處理異常，不消耗正常無快取歌曲', async () => {
  const f = fixture(['a', 'z'], { a: old('partial') });
  const r = await run_auto_enrichment({ ...f.options, retry_failed: true });
  assert.deepEqual(f.calls, ['a']);
  assert.equal(r.progress.normal_pending, 1);
  assert.equal(r.progress.remaining_total, 1);
  assert.equal(r.can_resume, true);
});

test('冷卻中的異常保留，無可查歌曲不等於全部完成', async () => {
  const f = fixture(['a'], { a: {
    ...old('not_found_404'), next_retry_after: '2100-01-01T00:00:00.000Z',
  } });
  const r = await run_auto_enrichment({ ...f.options, retry_failed: true });
  assert.deepEqual(f.calls, []);
  assert.equal(r.progress.cooldown_anomalies, 1);
  assert.equal(r.progress.deferred_anomalies, 1);
  assert.equal(r.progress.eligible_remaining, 0);
  assert.equal(r.aggregate.remaining_after_run, 1);
  assert.equal(r.can_resume, true);
  assert.equal(f.state.checkpoint_doc.last_track_id_processed, 'previous');
});

for (const retry_failed of [false, true]) {
  test(`長時間跨批次同 ID 不重查（retry=${retry_failed}）`, async () => {
    const f = fixture(['a', 'b', 'c'], retry_failed ? {
      a: old('partial'), b: old('network_error'), c: old('partial'),
    } : {});
    let now = Date.parse('2026-01-01T00:00:00.000Z');
    const r = await run_auto_enrichment({
      ...f.options, retry_failed, now_fn: () => now,
      fetch_track: async (id, opts) => {
        f.calls.push(id);
        assert_track_api_budget(`/v1/tracks/${id}`, opts);
        now += 2 * 60 * 60 * 1000;
        if (id === 'b') throw new SpotifyRequestError('network', 0);
        return { id }; // HTTP 200 partial，每首仍須最多進入一次處理
      },
    });
    assert.deepEqual(f.calls, ['a', 'b', 'c']);
    assert.equal(r.batches.length, 3);
    assert.equal(r.budget.consumed(), 3);
    assert.equal(r.progress.run_failed, 3);
    assert.equal(r.progress.remaining_total, 3);
    assert.equal(r.progress.deferred_anomalies, 3);
    assert.equal(r.progress.eligible_remaining, 0);
  });
  for (const code of [403, 429]) {
    test(`${code} 保留進度並停止（retry=${retry_failed}）`, async () => {
      const f = fixture(['a', 'b', 'c'], retry_failed ? {
        a: old('partial'), b: old('partial'), c: old('partial'),
      } : {});
      const r = await run_auto_enrichment({
        ...f.options, retry_failed,
        fetch_track: async (id, opts) => {
          f.calls.push(id);
          assert_track_api_budget(`/v1/tracks/${id}`, opts);
          if (id === 'a') return full(id);
          throw new SpotifyRequestError(String(code), code, null, 79386);
        },
      });
      assert.deepEqual(f.calls, ['a', 'b']);
      assert.equal(r.safe_stopped, true);
      assert.equal(r.progress.run_success, 1);
      assert.equal(r.progress.run_failed, 1);
      assert.equal(r.progress.remaining_total, 2);
      assert.equal(f.state.cache_doc.tracks_by_id.a.status, 'ok');
      assert.equal(f.saved.at(-1).checkpoint_doc.last_track_id_processed, 'b');
      assert.equal(f.saved.at(-1).checkpoint_doc.run_in_progress, false);
    });
  }
}

test('Ctrl+C 停止下一首，保留目前已完成歌曲與 checkpoint', async () => {
  const f = fixture(['a', 'b']);
  const abort_signal = { requested: false };
  const r = await run_auto_enrichment({
    ...f.options, abort_signal,
    fetch_track: async (id, opts) => {
      assert_track_api_budget(`/v1/tracks/${id}`, opts);
      f.calls.push(id);
      abort_signal.requested = true;
      return full(id);
    },
  });
  assert.deepEqual(f.calls, ['a']);
  assert.equal(r.safe_stopped, true);
  assert.match(r.stop_reason, /Ctrl\+C/);
  assert.equal(f.saved.at(-1).checkpoint_doc.last_track_id_processed, 'a');
});

test('底層重試仍共享 API attempt 預算，耗盡不覆寫未完成的快取', async () => {
  const f = fixture(['a', 'b'], { a: old('partial') });
  const before = structuredClone(f.state.cache_doc.tracks_by_id.a);
  const r = await run_auto_enrichment({
    ...f.options, total: 2, retry_failed: true,
    fetch_track: async (id, opts) => {
      f.calls.push(id);
      for (let i = 0; i < 3; i++) assert_track_api_budget(`/v1/tracks/${id}`, opts);
      return full(id);
    },
  });
  assert.deepEqual(f.calls, ['a']);
  assert.equal(r.budget.consumed(), 2);
  assert.equal(r.safe_stopped, true);
  assert.deepEqual(f.state.cache_doc.tracks_by_id.a, before);
});

test('dry-run 不查詢、不保存、不重置資料，摘要包含兩階段剩餘', async () => {
  const f = fixture(['a', 'b'], { a: old('partial') });
  const before = structuredClone(f.state);
  const r = await run_auto_enrichment({ ...f.options, dry_run: true });
  assert.deepEqual(f.state, before);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.saved, []);
  assert.deepEqual(f.summaries, []);
  assert.equal(r.plan.normal_pending, 1);
  assert.equal(r.plan.deferred_anomalies, 1);
  assert.equal(r.progress.remaining_total, 2);
});

test('完整 ok 即使不可播放仍跳過，已有 V2 metadata 不重新查詢', () => {
  const f = fixture(['a', 'b', 'c'], {
    a: { status: 'ok', name: 'Song', artists: [{ name: 'Artist' }],
      album: { id: 'album' }, is_playable: false },
  });
  f.state.track_index.b.name = 'Known';
  for (const phase of ['normal', 'retry']) {
    const q = build_enrichment_queue(f.state.track_index, f.state.cache_doc, Date.now(), undefined, { phase });
    assert.deepEqual(q.queue, phase === 'normal' ? ['c'] : []);
    assert.equal(q.skipped_cache_ok, 1);
    assert.equal(q.skipped_v2_has_meta, 1);
  }
});

test('逐首保存失敗後安全停止，不繼續下一首', async () => {
  const f = fixture(['a', 'b']);
  const r = await run_auto_enrichment({
    ...f.options,
    persist_fn: () => { throw new Error('disk full'); },
  });
  assert.deepEqual(f.calls, ['a']);
  assert.equal(r.safe_stopped, true);
  assert.match(r.stop_reason, /disk full/);
});
