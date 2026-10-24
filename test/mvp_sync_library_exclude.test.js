/**
 * MVP 智慧歌單自原始曲庫備份／合併排除（離線）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mvp_sync_spotify_playlist_id_set,
  BACKUP_READ_STATUS_EXCLUDED_MVP_SYNC,
} from '../lib/classification/mvp_playlist_sync_manifest.js';
import {
  api_playlist_entries_from_backup,
  build_track_index,
} from '../lib/import/merge_library.js';

test('manifest 彙整 Spotify playlist ID', function () {
  const ids = mvp_sync_spotify_playlist_id_set({
    playlists: {
      'lg:v2:mandarin:pop': { spotify_playlist_id: '4TBsqwvFUS0c68cQnyWNp2' },
      pending: { sync_status: 'pending' },
    },
  });
  assert.equal(ids.size, 1);
  assert.ok(ids.has('4TBsqwvFUS0c68cQnyWNp2'));
});

test('合併索引略過 excluded_mvp_sync 與 manifest ID', function () {
  const excluded_id = '4TBsqwvFUS0c68cQnyWNp2';
  const excluded = new Set([excluded_id]);
  const doc = {
    playlists: [
      {
        playlist_id: excluded_id,
        read_status: BACKUP_READ_STATUS_EXCLUDED_MVP_SYNC,
        tracks: [
          {
            spotify_id: 'aaaaaaaaaaaaaaaaaaaaaa',
            uri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa',
            name: 'InSmart',
            artists: [],
            playlist_id: excluded_id,
            playlist_name: 'Renamed By User',
            position: 0,
          },
        ],
      },
      {
        playlist_id: 'userPlaylist1111111111',
        read_status: 'ok',
        tracks: [
          {
            spotify_id: 'bbbbbbbbbbbbbbbbbbbbbb',
            uri: 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb',
            name: 'InUserList',
            artists: [],
            playlist_id: 'userPlaylist1111111111',
            playlist_name: 'My Mix',
            position: 0,
          },
        ],
      },
      {
        playlist_id: excluded_id,
        read_status: 'ok',
        tracks: [
          {
            spotify_id: 'cccccccccccccccccccccc',
            uri: 'spotify:track:cccccccccccccccccccccc',
            name: 'LegacyBackup',
            artists: [],
            playlist_id: excluded_id,
            playlist_name: 'Old name',
            position: 0,
          },
        ],
      },
    ],
  };
  const entries = api_playlist_entries_from_backup(doc, excluded);
  const index = build_track_index(entries, []);
  assert.equal(entries.length, 1);
  assert.equal(Object.keys(index).length, 1);
  assert.ok(index.bbbbbbbbbbbbbbbbbbbbbb);
});
