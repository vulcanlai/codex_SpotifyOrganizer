/**
 * MVP Spotify 同步（離線）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  is_valid_spotify_track_id,
  resolve_track_uri_for_sync,
  compute_track_list_hash,
  build_mvp_sync_plan,
  MVP_SPOTIFY_SYNC_AUTHORIZE_TOKEN,
  spotify_playlist_display_name,
  mvp_spotify_title_from_catalog_label,
} from '../lib/classification/mvp_playlist_sync.js';
import { chunk_uris, SPOTIFY_ADD_TRACKS_MAX } from '../lib/spotify_playlists_write.js';
import { get_mvp_sync_missing_scopes } from '../lib/auth/mvp_sync_scopes.js';
import { SCOPES } from '../lib/config.js';

test('Spotify 智慧歌單命名', function () {
  assert.equal(mvp_spotify_title_from_catalog_label('華語流行音樂'), '華語流行');
  assert.equal(
    spotify_playlist_display_name({
      kind: 'language_genre',
      language_bucket: 'mandarin',
      label_zh: '華語流行音樂',
      primary_genre: 'pop',
    }),
    '🎵 華語流行'
  );
  assert.equal(
    spotify_playlist_display_name({
      kind: 'language_genre',
      label_zh: '日韓流行音樂',
    }),
    '🎵 日韓流行'
  );
  assert.equal(
    spotify_playlist_display_name({
      kind: 'emotion_tentative',
      emotion_code: 'relaxed_comfort',
    }),
    '🎵 輕鬆 / 舒服'
  );
});

test('Spotify track id 驗證', function () {
  assert.equal(is_valid_spotify_track_id('0gk1SQ9nYJbpX90kTRZv4J'), true);
  assert.equal(is_valid_spotify_track_id('bad'), false);
});

test('URI 由 id 推導', function () {
  const r = resolve_track_uri_for_sync(null, '0gk1SQ9nYJbpX90kTRZv4J');
  assert.equal(r.uri, 'spotify:track:0gk1SQ9nYJbpX90kTRZv4J');
});

test('track list hash 穩定', function () {
  const h1 = compute_track_list_hash(['spotify:track:a', 'spotify:track:b']);
  const h2 = compute_track_list_hash(['spotify:track:b', 'spotify:track:a']);
  assert.equal(h1, h2);
});

test('chunk 100 首', function () {
  const uris = [];
  for (let i = 0; i < 250; i += 1) {
    uris.push('spotify:track:' + String(i).padStart(22, '0').slice(0, 22));
  }
  const chunks = chunk_uris(uris, SPOTIFY_ADD_TRACKS_MAX);
  assert.equal(chunks.length, 3);
});

test('sync plan 去重', function () {
  const catalog = {
    language_genre_playlists: [
      {
        playlist_id: 'lg:v2:mandarin:pop',
        kind: 'language_genre',
        primary_genre: 'pop',
        label_zh: '華語流行音樂',
        track_ids: ['0gk1SQ9nYJbpX90kTRZv4J', '0gk1SQ9nYJbpX90kTRZv4J'],
        track_count: 2,
      },
    ],
    emotion_playlists_tentative: [],
  };
  const index_doc = {
    tracks_by_id: {
      '0gk1SQ9nYJbpX90kTRZv4J': {
        merged_metadata: { uri: 'spotify:track:0gk1SQ9nYJbpX90kTRZv4J' },
      },
    },
  };
  const plan = build_mvp_sync_plan(catalog, index_doc);
  assert.equal(plan.playlists[0].valid_uri_count, 1);
});

test('config 含 playlist-modify-private', function () {
  assert.ok(SCOPES.indexOf('playlist-modify-private') >= 0);
});

test('apply 授權常數', function () {
  assert.ok(MVP_SPOTIFY_SYNC_AUTHORIZE_TOKEN.length > 10);
});

test('missing scopes 可計算（不輸出 token）', function () {
  const missing = get_mvp_sync_missing_scopes();
  assert.ok(Array.isArray(missing));
});

test('sync plan 可篩選單一 playlist_id', function () {
  const catalog = {
    language_genre_playlists: [
      {
        playlist_id: 'lg:v2:mandarin:pop',
        kind: 'language_genre',
        label_zh: '華語流行音樂',
        track_ids: ['0gk1SQ9nYJbpX90kTRZv4J'],
        track_count: 1,
      },
      {
        playlist_id: 'lg:v2:english:pop',
        kind: 'language_genre',
        label_zh: '英語流行音樂',
        track_ids: ['1M6J46n3jEHAdYMYHl15Pm'],
        track_count: 1,
      },
    ],
    emotion_playlists_tentative: [],
  };
  const plan = build_mvp_sync_plan(catalog, { tracks_by_id: {} }, {
    playlist_id: 'lg:v2:mandarin:pop',
  });
  assert.equal(plan.playlist_count, 1);
  assert.equal(plan.playlists[0].mvp_playlist_id, 'lg:v2:mandarin:pop');
});
