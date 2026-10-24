/**
 * albums_probe 離線測試（不呼叫 Spotify）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spotify_error_summary } from '../lib/probe/albums_probe.js';

test('spotify_error_summary 解析 error 物件', function () {
  const s = spotify_error_summary({
    error: { status: 403, message: 'Forbidden' },
  });
  assert.equal(s.status, 403);
  assert.equal(s.message, 'Forbidden');
});

test('spotify_error_summary 無 body 回傳 null', function () {
  assert.equal(spotify_error_summary(null), null);
});
