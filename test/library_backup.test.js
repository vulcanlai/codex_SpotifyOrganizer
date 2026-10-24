/**
 * 收藏專輯備份離線測試
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize_saved_album_row,
  normalize_album_track,
  playability_status_from_track,
} from '../lib/library/normalize.js';
import {
  is_album_tracks_complete,
  index_track_sections,
} from '../lib/library/storage.js';
import { count_track_stats } from '../lib/library/run_backup.js';

test('normalize_saved_album_row：保留 added_at 與 total_tracks', function () {
  const meta = normalize_saved_album_row(
    {
      added_at: '2024-01-01T00:00:00Z',
      album: {
        id: 'alb1',
        uri: 'spotify:album:alb1',
        name: 'Test Album',
        album_type: 'album',
        artists: [{ id: 'a1', name: 'Artist' }],
        release_date: '2020-01-01',
        total_tracks: 10,
      },
    },
    3
  );
  assert.equal(meta.position, 3);
  assert.equal(meta.album_id, 'alb1');
  assert.equal(meta.added_at, '2024-01-01T00:00:00Z');
  assert.equal(meta.total_tracks, 10);
});

test('normalize_album_track：缺欄位不拋錯', function () {
  const tr = normalize_album_track({}, { album_id: 'alb1', position: 0 });
  assert.equal(tr.spotify_id, null);
  assert.equal(tr.playability_status, 'unknown');
});

test('playability_status：is_playable false', function () {
  assert.equal(
    playability_status_from_track({ is_playable: false }),
    'not_playable'
  );
});

test('is_album_tracks_complete：total 不符為 false', function () {
  const meta = {
    album_id: 'a1',
    tracks_read_status: 'ok',
    tracks_fetched_count: 5,
    tracks_api_total: 10,
  };
  const sec = { read_status: 'ok', tracks: [{}, {}, {}, {}, {}] };
  assert.equal(is_album_tracks_complete(meta, sec), false);
});

test('is_album_tracks_complete：一致為 true', function () {
  const meta = {
    album_id: 'a1',
    tracks_read_status: 'ok',
    tracks_fetched_count: 2,
    tracks_api_total: 2,
  };
  const sec = { read_status: 'ok', tracks: [{ spotify_id: 't1' }, { spotify_id: 't2' }] };
  assert.equal(is_album_tracks_complete(meta, sec), true);
});

test('count_track_stats：保留重複列並統計 unique', function () {
  const stats = count_track_stats([
    {
      tracks: [
        { spotify_id: 't1' },
        { spotify_id: 't1' },
        { spotify_id: 't2' },
      ],
    },
  ]);
  assert.equal(stats.total_track_entries, 3);
  assert.equal(stats.unique_track_ids, 2);
});

test('index_track_sections：依 album_id 索引', function () {
  const map = index_track_sections({
    albums: [{ album_id: 'x', read_status: 'ok', tracks: [] }],
  });
  assert.ok(map.x);
});

test('模擬分頁：合併兩頁 album tracks', function () {
  const pages = [
    { items: [{ id: 't1', disc_number: 1, track_number: 1 }], total: 3, next: 'n' },
    { items: [{ id: 't2', disc_number: 1, track_number: 2 }, { id: 't3', disc_number: 2, track_number: 1 }], total: 3, next: null },
  ];
  const all = [];
  for (let p = 0; p < pages.length; p += 1) {
    for (let i = 0; i < pages[p].items.length; i += 1) {
      all.push(
        normalize_album_track(pages[p].items[i], {
          album_id: 'alb',
          position: all.length,
        })
      );
    }
  }
  assert.equal(all.length, 3);
  assert.equal(all[2].disc_number, 2);
});

test('重複執行：已完成專輯應判定可跳過', function () {
  const meta = {
    album_id: 'a1',
    tracks_read_status: 'ok',
    tracks_fetched_count: 1,
    tracks_api_total: 1,
  };
  const sec = { album_id: 'a1', read_status: 'ok', tracks: [{ spotify_id: 't1' }] };
  assert.equal(is_album_tracks_complete(meta, sec), true);
});
