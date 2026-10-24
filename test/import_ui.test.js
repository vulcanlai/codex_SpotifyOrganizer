/**
 * Web 匯入核心邏輯測試
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compute_batch_content_hash,
  parse_playlist_text,
  preview_playlist_import,
} from '../lib/import/parse_batch.js';

test('compute_batch_content_hash：相同內容雜湊一致', function () {
  const a = compute_batch_content_hash('https://open.spotify.com/track/abc123456789012345678901\n\n');
  const b = compute_batch_content_hash('  https://open.spotify.com/track/abc123456789012345678901  ');
  assert.equal(a, b);
});

test('preview：偵測重複批次', function () {
  const text = 'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6';
  const hash = compute_batch_content_hash(text);
  const preview = preview_playlist_import(
    text,
    { playlist_id: 'p1', playlist_name: 'T', start_position: 0 },
    [hash]
  );
  assert.equal(preview.duplicate_batch, true);
});

test('parse_playlist_text：保留合法重複曲目順序', function () {
  const line = 'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6';
  const text = line + '\n' + line;
  const parsed = parse_playlist_text(text, {
    playlist_id: 'p1',
    playlist_name: 'T',
    start_position: 0,
    batch_id: 'b1',
  });
  assert.equal(parsed.valid_count, 2);
  assert.equal(parsed.duplicate_entries, 1);
  assert.equal(parsed.tracks[0].position, 0);
  assert.equal(parsed.tracks[1].position, 1);
  assert.equal(parsed.tracks[0].playability_status, 'unknown');
});

test('append 批次：position 接續起算', function () {
  const parsed = parse_playlist_text(
    'spotify:track:6rqhFgbbKwnb9MLmUQDhG6',
    {
      playlist_id: 'p1',
      playlist_name: 'T',
      start_position: 7,
      batch_id: 'b2',
    }
  );
  assert.equal(parsed.tracks[0].position, 7);
});
