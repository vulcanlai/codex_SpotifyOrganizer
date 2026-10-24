/**
 * Spotify 歌單寫入 helpers（離線）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve_playlist_details_after_put } from '../lib/spotify_playlists_write.js';

test('PUT 空 body 時以請求 name 回填', function () {
  const r = resolve_playlist_details_after_put(null, 'abc123', {
    name: '🎵 輕鬆 / 舒服',
  });
  assert.equal(r.api_response_empty, true);
  assert.equal(r.name, '🎵 輕鬆 / 舒服');
  assert.equal(r.spotify_playlist_id, 'abc123');
});

test('PUT 有 JSON 時優先使用回應', function () {
  const r = resolve_playlist_details_after_put(
    { name: 'FromApi', description: 'D' },
    'id1',
    { name: 'Sent' }
  );
  assert.equal(r.name, 'FromApi');
  assert.equal(r.description, 'D');
  assert.equal(r.api_response_empty, false);
});
