/**
 * MVP Spotify 歌單命名（離線）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mvp_spotify_genre_title_for_special_buckets,
  mvp_spotify_emotion_title_zh,
  mvp_spotify_normalize_slash_in_display_name,
  spotify_playlist_display_name,
  mvp_sync_playlist_description_zh,
} from '../lib/classification/mvp_spotify_playlist_naming.js';
import {
  LANG_BUCKET_OTHER,
  LANG_BUCKET_UNKNOWN_INSTRUMENTAL,
} from '../lib/classification/mvp_language_buckets.js';

test('斜線正規化', function () {
  assert.equal(
    mvp_spotify_normalize_slash_in_display_name('🎵 華語金屬／龐克'),
    '🎵 華語金屬 / 龐克'
  );
  assert.equal(
    mvp_spotify_normalize_slash_in_display_name('🎵 深夜 / 沉靜'),
    '🎵 深夜 / 沉靜'
  );
  assert.equal(
    mvp_spotify_normalize_slash_in_display_name('🎵 配樂／器樂 / 其他'),
    '🎵 配樂 / 器樂 / 其他'
  );
  assert.equal(
    mvp_spotify_normalize_slash_in_display_name('🎵 雷鬼／世界音樂'),
    '🎵 雷鬼 / 世界音樂'
  );
});

test('語言×曲風複合曲風 Spotify 標題', function () {
  assert.equal(
    spotify_playlist_display_name({
      kind: 'language_genre',
      language_bucket: 'mandarin',
      label_zh: '華語R&B／靈魂樂音樂',
      primary_genre: 'rnb_soul',
    }),
    '🎵 華語R&B / 靈魂樂'
  );
  assert.equal(
    spotify_playlist_display_name({
      kind: 'language_genre',
      language_bucket: LANG_BUCKET_OTHER,
      primary_genre: 'soundtrack_instrumental',
    }),
    '🎵 配樂 / 器樂'
  );
});

test('special bucket 曲風標題', function () {
  assert.equal(mvp_spotify_genre_title_for_special_buckets('流行'), '流行音樂');
  assert.equal(mvp_spotify_genre_title_for_special_buckets('搖滾'), '搖滾音樂');
  assert.equal(mvp_spotify_genre_title_for_special_buckets('配樂／器樂'), '配樂／器樂');
  assert.equal(
    mvp_spotify_genre_title_for_special_buckets('雷鬼／世界音樂'),
    '雷鬼／世界音樂'
  );
});

test('other_lang 歌單標題', function () {
  assert.equal(
    spotify_playlist_display_name({
      kind: 'language_genre',
      language_bucket: LANG_BUCKET_OTHER,
      primary_genre: 'pop',
      label_zh: '其他語言流行音樂',
    }),
    '🎵 流行音樂'
  );
  assert.equal(
    spotify_playlist_display_name({
      kind: 'language_genre',
      language_bucket: LANG_BUCKET_OTHER,
      primary_genre: 'soundtrack_instrumental',
    }),
    '🎵 配樂 / 器樂'
  );
});

test('unknown_or_instrumental 歌單標題與描述', function () {
  const pl = {
    kind: 'language_genre',
    language_bucket: LANG_BUCKET_UNKNOWN_INSTRUMENTAL,
    primary_genre: 'classical',
    label_zh: '語言未知／純音樂古典音樂',
  };
  assert.equal(spotify_playlist_display_name(pl), '🎵 古典音樂 / 其他');
  const desc = mvp_sync_playlist_description_zh(pl);
  assert.ok(desc.indexOf('並非全部為純音樂') >= 0);
  assert.ok(desc.indexOf('古典') >= 0);
});

test('華語／情緒標題維持原規則', function () {
  assert.equal(
    spotify_playlist_display_name({
      kind: 'language_genre',
      language_bucket: 'mandarin',
      label_zh: '華語流行音樂',
      primary_genre: 'pop',
    }),
    '🎵 華語流行'
  );
  assert.equal(mvp_spotify_emotion_title_zh('relaxed_comfort'), '輕鬆 / 舒服');
  assert.equal(mvp_spotify_emotion_title_zh('late_night_calm'), '深夜 / 沉靜');
  assert.equal(
    spotify_playlist_display_name({
      kind: 'emotion_tentative',
      emotion_code: 'relaxed_comfort',
    }),
    '🎵 輕鬆 / 舒服'
  );
  assert.equal(
    spotify_playlist_display_name({
      kind: 'emotion_tentative',
      emotion_code: 'energetic_passion',
    }),
    '🎵 熱血 / 動感'
  );
});
