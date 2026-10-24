/**
 * 人工分類 CLI 核心（虛構 ID，不寫正式 manual-overrides）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parse_spotify_id_list,
  is_valid_spotify_id,
} from '../lib/classification/manual_classify/spotify_id_parse.js';
import {
  normalize_playlist_query,
  match_mvp_playlist_query,
  load_mvp_playlist_registry,
  resolve_playlist_queries,
} from '../lib/classification/manual_classify/mvp_playlist_resolver.js';
import {
  merge_track_override_patch,
  validate_manual_classify_patch,
  override_row_semantically_equal,
  build_revoke_patch,
} from '../lib/classification/manual_classify/override_patch.js';
import {
  build_manual_classify_plan,
  apply_manual_classify_plan,
  resolve_target_track_ids,
  album_blocks_manual_classify_apply,
} from '../lib/classification/manual_classify/manual_classify_core.js';
import { build_classification_index } from '../lib/classification/build_index.js';
import { empty_overrides_doc } from '../lib/classification/overrides_store.js';
import { build_mvp_playlist_catalog } from '../lib/classification/mvp_smart_playlists.js';

const FAKE_TRACK_A = '0000000000000000000001';
const FAKE_TRACK_B = '0000000000000000000002';
const FAKE_ALBUM = '00000000000000000000aa';

test('1. 解析 Track URL 與多筆 ID', function () {
  const parsed = parse_spotify_id_list(
    'spotify:track:6rqhFgbbKwnb9MLmUQDhG6,spotify:track:4iV5W9uYEdYUVa79Axb7Nr'
  );
  assert.equal(parsed.tracks.length, 2);
  assert.equal(parsed.invalid_tokens.length, 0);
});

test('2. 專輯 ID 與 unknown 22 字元', function () {
  const parsed = parse_spotify_id_list('spotify:album:' + FAKE_ALBUM + ' ' + FAKE_TRACK_A);
  assert.deepEqual(parsed.albums, [FAKE_ALBUM]);
  assert.deepEqual(parsed.unknown_ids, [FAKE_TRACK_A]);
});

test('3. 歌單名稱忽略 🎵 與別名', function () {
  assert.equal(normalize_playlist_query('🎵英語民謠'), '英語民謠');
  assert.equal(normalize_playlist_query('英語名謠'), '英語民謠');
  assert.equal(normalize_playlist_query('配樂器樂'), '配樂 / 器樂');
});

test('4. 唯一匹配英語民謠', function () {
  const reg = load_mvp_playlist_registry();
  const m = match_mvp_playlist_query('英語民謠', reg);
  assert.equal(m.status, 'unique');
  assert.equal(m.matches[0].playlist_id, 'lg:v2:english:folk');
});

test('5. 深夜沉靜 → emotion', function () {
  const reg = load_mvp_playlist_registry();
  const r = resolve_playlist_queries(['深夜沉靜'], reg);
  assert.equal(r.ok, true);
  assert.deepEqual(r.emotion_playlist_ids, ['emotion:late_night_calm']);
});

test('6. 歧義：民謠無語言桶', function () {
  const reg = load_mvp_playlist_registry();
  const m = match_mvp_playlist_query('民謠', reg);
  assert.equal(m.status, 'ambiguous');
});

test('7. 同一首歌多張歌單 patch 合併', function () {
  let row = null;
  row = merge_track_override_patch(row, {
    mvp_playlist_ids: ['lg:v2:english:folk'],
  });
  row = merge_track_override_patch(row, {
    mvp_playlist_ids: ['lg:v2:english:soundtrack_instrumental'],
    emotion_playlist_ids: ['emotion:late_night_calm'],
  });
  assert.equal(row.mvp_playlist_ids.length, 2);
  assert.equal(row.emotion_playlist_ids.length, 1);
});

test('8. 重複 apply 語意相等', function () {
  const row = merge_track_override_patch(null, {
    language: '英文',
    genre_profile: { primary_genre: 'folk', secondary_genres: [], subgenres: [] },
    mvp_playlist_ids: ['lg:v2:english:folk'],
  });
  const again = merge_track_override_patch(row, {
    language: '英文',
    genre_profile: { primary_genre: 'folk', secondary_genres: [], subgenres: [] },
    mvp_playlist_ids: ['lg:v2:english:folk'],
  });
  assert.equal(override_row_semantically_equal(row, again), true);
});

test('9. metadata_missing 仍可規劃（不在曲庫則標記）', function () {
  const plan = build_manual_classify_plan({
    track_tokens: FAKE_TRACK_A,
    language: '英文',
    primary_genre: 'folk',
    playlists: '英語民謠',
    overrides_doc: empty_overrides_doc(),
  });
  assert.equal(plan.tracks.length, 1);
  assert.equal(plan.tracks[0].in_library, false);
  assert.equal(plan.shared_patch_validation.ok, true);
});

test('10. G3-F 衝突說明保留 registry', function () {
  const overrides_doc = empty_overrides_doc();
  const registry_doc = {
    adoptions_by_track_id: {
      [FAKE_TRACK_A]: { status: 'adopted', adopted_classification: { genre_profile: { primary_genre: 'rock' } } },
    },
  };
  const plan = build_manual_classify_plan({
    track_tokens: FAKE_TRACK_A,
    primary_genre: 'folk',
    overrides_doc: overrides_doc,
    registry_doc: registry_doc,
  });
  assert.ok(plan.tracks[0].conflicts.length >= 1);
});

test('11. classify build 保留人工 membership 欄位', function () {
  const overrides = empty_overrides_doc();
  overrides.overrides_by_track_id['00BoQyD7l8sQ6DreBlbD8R'] = {
    source: 'test:manual',
    language: '國語',
    mvp_playlist_ids: ['lg:v2:mandarin:pop'],
    locked_dimensions: ['mvp_playlists'],
  };
  const built = build_classification_index({ write: false, overrides_doc: overrides });
  const row = built.index_doc.tracks_by_id['00BoQyD7l8sQ6DreBlbD8R'];
  assert.ok(row.manual_playlist_membership);
  assert.deepEqual(row.manual_playlist_membership.mvp_playlist_ids, ['lg:v2:mandarin:pop']);
});

test('12. catalog 反映多重人工歌單', function () {
  const index_doc = {
    tracks_by_id: {
      t1: {
        display: { name: 'X', artists: ['A'] },
        genre_profile: { primary_genre: 'folk', confidence: 'confirmed' },
        tags: [{ dimension: 'language', value: '英文', is_manual_override: true }],
        manual_playlist_membership: {
          mvp_playlist_ids: ['lg:v2:english:folk', 'lg:v2:english:soundtrack_instrumental'],
          emotion_playlist_ids: ['emotion:late_night_calm'],
        },
      },
    },
  };
  const cat = build_mvp_playlist_catalog(index_doc);
  const folk = cat.language_genre_playlists.find(function (p) {
    return p.playlist_id === 'lg:v2:english:folk';
  });
  const ost = cat.language_genre_playlists.find(function (p) {
    return p.playlist_id === 'lg:v2:english:soundtrack_instrumental';
  });
  const calm = cat.emotion_playlists_tentative.find(function (p) {
    return p.playlist_id === 'emotion:late_night_calm';
  });
  assert.ok(folk && folk.track_ids.indexOf('t1') >= 0);
  assert.ok(ost && ost.track_ids.indexOf('t1') >= 0);
  assert.ok(calm && calm.track_ids.indexOf('t1') >= 0);
});

test('13. 撤銷 playlists 保留 language', function () {
  const prev = {
    language: '英文',
    mvp_playlist_ids: ['lg:v2:english:folk'],
    locked_dimensions: ['language', 'mvp_playlists'],
  };
  const rev = build_revoke_patch(prev, 'playlists');
  assert.equal(rev.action, 'replace_row');
  assert.equal(rev.row.language, '英文');
  assert.equal(rev.row.mvp_playlist_ids, undefined);
});

test('14. apply dry（不寫檔）', function () {
  const plan = build_manual_classify_plan({
    track_tokens: FAKE_TRACK_B,
    playlists: '英語民謠',
    overrides_doc: empty_overrides_doc(),
  });
  const res = apply_manual_classify_plan(plan, { write: false });
  assert.equal(res.ok, true);
});

test('15. patch 驗證拒絕非法 emotion', function () {
  const v = validate_manual_classify_patch({
    emotion_playlist_ids: ['emotion:not_a_code'],
  });
  assert.equal(v.ok, false);
});

test('16. 無效 spotify id', function () {
  assert.equal(is_valid_spotify_id('short'), false);
});

test('17. --album ID 展開曲目', function () {
  const t = resolve_target_track_ids({ album: '14W5TKHpGghGbgFlkxfbWm' });
  assert.equal(t.album_ids_requested.length, 1);
  assert.equal(t.track_ids.length, 10);
});

test('18. 專輯 Spotify URL 解析', function () {
  const t = resolve_target_track_ids({
    album: 'https://open.spotify.com/album/14W5TKHpGghGbgFlkxfbWm?si=x',
  });
  assert.equal(t.album_ids_requested[0], '14W5TKHpGghGbgFlkxfbWm');
  assert.equal(t.track_ids.length, 10);
});

test('19. 不完整專輯阻擋 apply', function () {
  const gate = album_blocks_manual_classify_apply({
    albums: [
      {
        album_id: 'fakealbum000000000001',
        incomplete: true,
        ok: true,
        track_ids: ['0000000000000000000001'],
      },
    ],
  });
  assert.equal(gate.blocked, true);
  const plan = build_manual_classify_plan({
    track_tokens: '0000000000000000000001',
    playlists: '英語民謠',
    overrides_doc: empty_overrides_doc(),
  });
  assert.equal(typeof plan.album_apply_blocked, 'boolean');
});
