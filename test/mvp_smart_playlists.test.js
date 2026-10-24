/**
 * MVP 智慧歌單（離線）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  build_mvp_playlist_catalog,
  tentative_emotion_tags_from_row,
  TENTATIVE_CONTEXT_TO_EMOTION,
} from '../lib/classification/mvp_smart_playlists.js';

test('語言×曲風歌單去重', function () {
  const index_doc = {
    tracks_by_id: {
      a: {
        display: { name: 'T1', artists: ['X'] },
        genre_profile: { primary_genre: 'pop', source: 'g3-f-adopt-registry.json', confidence: 'inferred' },
        tags: [{ dimension: 'language', value: '國語', confidence: 'inferred' }],
      },
      b: {
        display: { name: 'T2', artists: ['Y'] },
        genre_profile: { primary_genre: 'pop', source: 'legacy_migration', confidence: 'unknown' },
        tags: [{ dimension: 'language', value: '英文', confidence: 'inferred' }],
      },
      c: {
        display: { name: 'T3', artists: ['Z'] },
        genre_profile: { primary_genre: 'unknown' },
        tags: [],
      },
    },
  };
  const cat = build_mvp_playlist_catalog(index_doc);
  const mandarin_pop = cat.language_genre_playlists.find(function (p) {
    return p.playlist_id === 'lg:v2:mandarin:pop';
  });
  const english_pop = cat.language_genre_playlists.find(function (p) {
    return p.playlist_id === 'lg:v2:english:pop';
  });
  assert.ok(mandarin_pop);
  assert.equal(mandarin_pop.track_count, 1);
  assert.equal(mandarin_pop.label_zh, '華語流行音樂');
  assert.ok(english_pop);
  assert.equal(english_pop.track_count, 1);
});

test('context 僅產暫定 emotion', function () {
  const tags = tentative_emotion_tags_from_row({
    tags: [
      { dimension: 'context', value: '放鬆', confidence: 'inferred' },
    ],
  });
  assert.equal(tags.length, 1);
  assert.equal(tags[0].code, TENTATIVE_CONTEXT_TO_EMOTION['放鬆']);
  assert.equal(tags[0].confidence, 'tentative');
});
