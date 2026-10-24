import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assess_enrichment_cache_entry,
  cache_entry_trusted_for_merge,
} from '../lib/enrichment/metadata_cache_guard.js';

test('拒絕 spotify_id 與 key 不一致', function () {
  const r = assess_enrichment_cache_entry('aaa', {
    spotify_id: 'bbb',
    status: 'ok',
    name: 'x',
    artists: [{ name: 'a' }],
    album: { name: 'al' },
  });
  assert.equal(r.trusted, false);
  assert.equal(r.reason, 'spotify_id_mismatch');
});

test('拒絕 partial 與假 ok（缺歌名）', function () {
  assert.equal(
    cache_entry_trusted_for_merge('id1', { spotify_id: 'id1', status: 'partial' }),
    false
  );
  assert.equal(
    cache_entry_trusted_for_merge('id1', {
      spotify_id: 'id1',
      status: 'ok',
      name: '',
      artists: [{ name: 'a' }],
      album: { name: 'b' },
    }),
    false
  );
});

test('接受完整 ok', function () {
  assert.equal(
    cache_entry_trusted_for_merge('id1', {
      spotify_id: 'id1',
      status: 'ok',
      name: 'Song',
      artists: [{ name: 'Artist' }],
      album: { name: 'Album' },
    }),
    true
  );
});
