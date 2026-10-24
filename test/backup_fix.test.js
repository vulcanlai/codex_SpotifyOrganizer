/**
 * 備份相關單元測試（模擬 API 資料，不呼叫 Spotify）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize_playlist_meta,
  normalize_playlist_track_entry,
  resolve_media_from_row,
  classify_item_track,
} from '../lib/backup/track_normalize.js';
import {
  playlist_ownership_kind,
  can_fetch_playlist_items,
} from '../lib/backup/playlist_access.js';
import { compute_backup_flags } from '../lib/backup/run_backup.js';

const USER = '31bg7xdzwxzuh2mneyhzjpoiks4a';

test('normalize_playlist_meta：缺少 tracks/items 不拋錯', function () {
  const meta = normalize_playlist_meta({ id: 'abc', name: '測試' });
  assert.equal(meta.track_count, null);
});

test('normalize_playlist_meta：items.total（新版）', function () {
  const meta = normalize_playlist_meta({
    id: 'abc',
    items: { total: 12 },
  });
  assert.equal(meta.track_count, 12);
});

test('normalize_playlist_meta：tracks.total（舊版列表）', function () {
  const meta = normalize_playlist_meta({
    id: 'abc',
    tracks: { total: 17 },
  });
  assert.equal(meta.track_count, 17);
});

test('resolve_media_from_row：新版 item 欄位', function () {
  const media = resolve_media_from_row({
    added_at: '2020-01-01',
    item: { id: 't1', type: 'track', name: 'Song' },
  });
  assert.equal(media.id, 't1');
});

test('resolve_media_from_row：舊版 track 欄位', function () {
  const media = resolve_media_from_row({
    track: { id: 't2', name: 'Old' },
  });
  assert.equal(media.id, 't2');
});

test('normalize_playlist_track_entry：新版 /items 列', function () {
  const entry = normalize_playlist_track_entry({
    position: 0,
    item: {
      added_at: '2024-01-01T00:00:00Z',
      is_local: false,
      item: {
        id: 'abc123',
        uri: 'spotify:track:abc123',
        name: '測試曲',
        type: 'track',
        duration_ms: 200000,
        artists: [{ name: '歌手A' }],
        album: { name: '專輯X', release_date: '2023-05-01' },
      },
    },
    playlist: { id: 'pl1', name: '我的歌單', uri: 'spotify:playlist:pl1' },
  });
  assert.equal(entry.spotify_id, 'abc123');
  assert.equal(entry.artists[0], '歌手A');
  assert.equal(entry.album_name, '專輯X');
  assert.equal(entry.playlist_name, '我的歌單');
  assert.equal(entry.track_status, 'ok');
});

test('normalize_playlist_track_entry：item 為 null（下架）', function () {
  const entry = normalize_playlist_track_entry({
    position: 3,
    item: { added_at: null, item: null },
    playlist: { id: 'pl1', name: 'P', uri: null },
  });
  assert.equal(entry.track_status, 'unavailable');
  assert.equal(entry.spotify_id, null);
});

test('normalize_playlist_track_entry：local track', function () {
  const entry = normalize_playlist_track_entry({
    position: 1,
    item: { is_local: true, item: { name: 'local.mp3' } },
    playlist: { id: 'pl1', name: 'P', uri: null },
  });
  assert.equal(entry.track_status, 'local');
});

test('normalize_playlist_track_entry：episode', function () {
  const entry = normalize_playlist_track_entry({
    position: 0,
    item: {
      item: {
        type: 'episode',
        id: 'ep1',
        name: 'Podcast',
        duration_ms: 1000,
      },
    },
    playlist: { id: 'pl1', name: 'P', uri: null },
  });
  assert.equal(entry.track_status, 'episode');
});

test('playlist_ownership_kind：自有 / 共同編輯 / 受限制', function () {
  assert.equal(
    playlist_ownership_kind(USER, { owner_id: USER, collaborative: false }),
    'owned'
  );
  assert.equal(
    playlist_ownership_kind(USER, {
      owner_id: 'other',
      collaborative: true,
    }),
    'collaborative'
  );
  assert.equal(
    playlist_ownership_kind(USER, {
      owner_id: 'other',
      collaborative: false,
    }),
    'restricted'
  );
});

test('can_fetch_playlist_items：受限制不發 API', function () {
  assert.equal(
    can_fetch_playlist_items(USER, {
      owner_id: 'other',
      collaborative: false,
    }),
    false
  );
  assert.equal(
    can_fetch_playlist_items(USER, { owner_id: USER, collaborative: false }),
    true
  );
});

test('模擬 /items 分頁合併', function () {
  const pages = [
    {
      items: [{ item: { id: '1' } }, { item: { id: '2' } }],
      total: 3,
      next: 'https://api.spotify.com/v1/next',
    },
    { items: [{ item: { id: '3' } }], total: 3, next: null },
  ];
  const all = [];
  let total = null;
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    if (typeof page.total === 'number') {
      total = page.total;
    }
    for (let j = 0; j < page.items.length; j += 1) {
      all.push(page.items[j]);
    }
  }
  assert.equal(all.length, 3);
  assert.equal(total, 3);
});

test('library_backup_complete：有受限制歌單為 false', function () {
  const flags = compute_backup_flags({
    user_profile_ok: true,
    playlists_list_ok: true,
    liked_tracks_ok: true,
    readable_playlists_failed: 0,
    restricted_playlists: 13,
    errors_length: 0,
  });
  assert.equal(flags.readable_backup_complete, true);
  assert.equal(flags.library_backup_complete, false);
});

test('library_backup_complete：可讀歌單 API 失敗為 false', function () {
  const flags = compute_backup_flags({
    user_profile_ok: true,
    playlists_list_ok: true,
    liked_tracks_ok: true,
    readable_playlists_failed: 1,
    restricted_playlists: 0,
    errors_length: 1,
  });
  assert.equal(flags.readable_backup_complete, false);
  assert.equal(flags.library_backup_complete, false);
});

test('403 情境：受限制歌單不計入 readable_playlists_failed', function () {
  const restricted = 13;
  const readable_failed = 0;
  const flags = compute_backup_flags({
    user_profile_ok: true,
    playlists_list_ok: true,
    liked_tracks_ok: true,
    readable_playlists_failed: readable_failed,
    restricted_playlists: restricted,
    errors_length: 0,
  });
  assert.equal(flags.backup_complete, true);
  assert.equal(flags.library_backup_complete, false);
});
