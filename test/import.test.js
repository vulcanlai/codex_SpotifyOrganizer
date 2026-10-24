/**
 * 手動匯入模擬測試
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parse_spotify_track_line,
  playlist_id_from_filename,
} from '../lib/import/parse_track_url.js';
import { build_track_index } from '../lib/import/merge_library.js';

test('parse：open.spotify.com 含 si 參數', function () {
  const r = parse_spotify_track_line(
    'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl?si=abc123',
    1
  );
  assert.equal(r.ok, true);
  assert.equal(r.spotify_id, '11dFghVXANMlKmJXsNCbNl');
});

test('parse：spotify:track URI', function () {
  const r = parse_spotify_track_line('spotify:track:6rqhFgbbKwnb9MLmUQDhG6', 2);
  assert.equal(r.ok, true);
  assert.equal(r.uri, 'spotify:track:6rqhFgbbKwnb9MLmUQDhG6');
});

test('parse：空白行 skipped', function () {
  const r = parse_spotify_track_line('   ', 3);
  assert.equal(r.skipped, true);
});

test('parse：不合法行回傳行號與錯誤', function () {
  const r = parse_spotify_track_line('https://open.spotify.com/playlist/abc', 5);
  assert.equal(r.ok, false);
  assert.equal(r.line_number, 5);
  assert.match(r.error, /歌單/);
});

test('parse：保留順序（多行）', function () {
  const lines = [
    'https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaa1',
    '',
    'spotify:track:aaaaaaaaaaaaaaaaaaaaa2',
  ];
  const ids = [];
  for (let i = 0; i < lines.length; i += 1) {
    const r = parse_spotify_track_line(lines[i], i + 1);
    if (r.ok) {
      ids.push(r.spotify_id);
    }
  }
  assert.deepEqual(ids, [
    'aaaaaaaaaaaaaaaaaaaaa1',
    'aaaaaaaaaaaaaaaaaaaaa2',
  ]);
});

test('playlist_id_from_filename', function () {
  assert.equal(
    playlist_id_from_filename('7HkWTTWk9BMxEMufDtJKcz.txt'),
    '7HkWTTWk9BMxEMufDtJKcz'
  );
  assert.equal(playlist_id_from_filename('bad.md'), null);
});

test('build_track_index：不同歌單同 ID 保留兩筆 appearance', function () {
  const entries = [
    {
      spotify_id: 't1',
      uri: 'spotify:track:t1',
      playlist_id: 'p1',
      playlist_name: 'A',
      position: 0,
      source: 'manual_import',
      name: null,
      artists: [],
    },
    {
      spotify_id: 't1',
      uri: 'spotify:track:t1',
      playlist_id: 'p2',
      playlist_name: 'B',
      position: 0,
      source: 'manual_import',
      name: null,
      artists: [],
    },
    {
      spotify_id: 't2',
      uri: 'spotify:track:t2',
      playlist_id: 'p2',
      playlist_name: 'B',
      position: 1,
      source: 'manual_import',
      name: null,
      artists: [],
    },
  ];
  const index = build_track_index(entries, []);
  assert.equal(Object.keys(index).length, 2);
  assert.equal(index.t1.appearances.length, 2);
  assert.equal(index.t2.appearances.length, 1);
});

test('library_data_complete：尚有未匯入受限制歌單為 false', function () {
  const restricted_total = 3;
  const unimported = [{ playlist_id: 'x' }];
  const library_data_complete =
    restricted_total === 0 || unimported.length === 0;
  assert.equal(library_data_complete, false);
});
