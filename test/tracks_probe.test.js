/**
 * Track metadata probe 離線測試
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  is_id_only_track_row,
  select_id_only_tracks_from_index,
} from '../lib/probe/library_v2_select.js';
import {
  parse_track_catalog_response,
  apply_playability_note,
  run_tracks_probe,
  PROBE_TRACKS_MAX,
} from '../lib/probe/tracks_probe.js';
import { SpotifyRequestError } from '../lib/spotify_api.js';
import { FILE_LIBRARY_V2 } from '../lib/merge/v2/paths.js';

test('is_id_only_track_row：仅有 ID', function () {
  assert.equal(
    is_id_only_track_row({ spotify_id: 'abc', name: null, artists: [] }),
    true
  );
  assert.equal(
    is_id_only_track_row({ spotify_id: 'abc', name: 'Title', artists: [] }),
    false
  );
});

test('select_id_only_tracks_from_index：最多 10 首且排序穩定', function () {
  const index = {
    zzz: { spotify_id: 'zzz', artists: [] },
    aaa: { spotify_id: 'aaa', artists: [] },
    mid: { spotify_id: 'mid', name: 'Has', artists: [] },
  };
  const picked = select_id_only_tracks_from_index(index, 10);
  assert.deepEqual(picked, ['aaa', 'zzz']);
});

test('run_tracks_probe：超過 10 首仍只查 10', async function () {
  const ids = [];
  for (let i = 0; i < 15; i += 1) {
    ids.push(`id${i}`);
  }
  let calls = 0;
  const report = await run_tracks_probe({
    track_ids: ids,
    max_tracks: 20,
    fetch_track: async function () {
      calls += 1;
      return { id: 'x', name: 'T', artists: [], album: { id: 'a', name: 'A' } };
    },
  });
  assert.equal(calls, PROBE_TRACKS_MAX);
  assert.equal(report.queries_attempted, PROBE_TRACKS_MAX);
});

test('parse_track_catalog_response：缺欄位保留 null', function () {
  const meta = parse_track_catalog_response({ id: 't1', name: 'Only' });
  assert.equal(meta.name, 'Only');
  assert.equal(meta.album, null);
  assert.equal(meta.duration_ms, null);
});

test('apply_playability_note：200 但 is_playable false', function () {
  const meta = apply_playability_note(
    parse_track_catalog_response({
      id: 't1',
      name: 'X',
      is_playable: false,
      artists: [],
    })
  );
  assert.equal(meta.http_200_playable, false);
  assert.equal(meta.playability_status, 'not_playable');
});

test('HTTP 404：單首失敗不崩潰', async function () {
  const report = await run_tracks_probe({
    track_ids: ['ok1', 'missing'],
    fetch_track: async function (id) {
      if (id === 'missing') {
        throw new SpotifyRequestError('Not found', 404);
      }
      return { id: 'ok1', name: 'OK', artists: [] };
    },
  });
  assert.equal(report.success_count, 1);
  assert.equal(report.fail_count, 1);
  assert.equal(report.results[1].http_status, 404);
});

test('HTTP 403 / 401 記錄', async function () {
  const report = await run_tracks_probe({
    track_ids: ['a'],
    fetch_track: async function () {
      throw new SpotifyRequestError('Forbidden', 403);
    },
  });
  assert.equal(report.results[0].http_status, 403);
});

test('HTTP 429 長 Retry-After 停止後續', async function () {
  let calls = 0;
  const report = await run_tracks_probe({
    track_ids: ['a', 'b'],
    fetch_track: async function () {
      calls += 1;
      throw new SpotifyRequestError('rate', 429, null, 120);
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.stopped_early, true);
});

test('不修改 library-v2 檔案 mtime', async function () {
  if (!fs.existsSync(FILE_LIBRARY_V2)) {
    return;
  }
  const before = fs.statSync(FILE_LIBRARY_V2).mtimeMs;
  await run_tracks_probe({
    track_ids: ['fake'],
    fetch_track: async function () {
      return { id: 'fake', name: 'N', artists: [] };
    },
  });
  const after = fs.statSync(FILE_LIBRARY_V2).mtimeMs;
  assert.equal(before, after);
});
