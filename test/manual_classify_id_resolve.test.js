/**
 * 純 Spotify ID 本機類型判斷
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse_spotify_id_list } from '../lib/classification/manual_classify/spotify_id_parse.js';
import {
  resolve_unknown_spotify_id,
  build_spotify_classify_input_fields,
  apply_local_resolution_to_parsed,
} from '../lib/classification/manual_classify/spotify_id_resolve_local.js';
import { resolve_target_track_ids } from '../lib/classification/manual_classify/manual_classify_core.js';
import {
  sort_playlists_for_ui,
  group_playlists_for_ui,
  summarize_playlist_ui_groups,
} from '../lib/classification/manual_classify/mvp_playlist_ui_sort.js';
import { list_mvp_playlists_for_ui } from '../lib/classification/manual_classify/manual_classify_web_service.js';

const DRAGON_ALBUM = '14W5TKHpGghGbgFlkxfbWm';
const FAKE_UNKNOWN = '00000000000000000000ff';

test('完整 Album URL → 專輯解析', function () {
  const parsed = parse_spotify_id_list('https://open.spotify.com/album/' + DRAGON_ALBUM);
  assert.deepEqual(parsed.albums, [DRAGON_ALBUM]);
  assert.equal(parsed.tracks.length, 0);
});

test('純 Album ID（Dragon Age）→ album-tracks 判定為專輯', function () {
  const r = resolve_unknown_spotify_id(DRAGON_ALBUM);
  assert.equal(r.kind, 'album');
  const fields = build_spotify_classify_input_fields({
    spotify_input: DRAGON_ALBUM,
    playlist_ids: ['lg:v2:english:folk'],
  });
  assert.equal(fields.spotify_input_resolution.needs_type_choice.length, 0);
  assert.equal(fields.album, DRAGON_ALBUM);
  const targets = resolve_target_track_ids({
    track_tokens: fields.track_tokens,
    album: fields.album,
  });
  assert.equal(targets.track_ids.length, 10);
});

test('純 ID 不在本機索引 → 需使用者指定類型', function () {
  const r = resolve_unknown_spotify_id(FAKE_UNKNOWN);
  assert.equal(r.kind, 'needs_hint');
  const targets = resolve_target_track_ids({ track_tokens: FAKE_UNKNOWN });
  assert.equal(targets.id_resolution.blocked, true);
  assert.equal(targets.track_ids.length, 0);
});

test('純 ID 加上 album hint → 可解析', function () {
  const targets = resolve_target_track_ids({
    track_tokens: FAKE_UNKNOWN,
    spotify_id_kind: 'track',
  });
  assert.equal(targets.id_resolution.blocked, false);
  assert.deepEqual(targets.track_ids, [FAKE_UNKNOWN]);
});

test('不再把 unknown 直接當 track', function () {
  const parsed = parse_spotify_id_list(DRAGON_ALBUM);
  assert.equal(parsed.unknown_ids.length, 1);
  const resolution = apply_local_resolution_to_parsed(parsed);
  assert.equal(resolution.tracks.length, 0);
  assert.deepEqual(resolution.albums, [DRAGON_ALBUM]);
});

test('42 張歌單排序：情緒優先、曲風內華語在英語前（流行）', function () {
  const list = list_mvp_playlists_for_ui();
  assert.equal(list.count, 42);
  const sorted = sort_playlists_for_ui(list.playlists);
  assert.equal(sorted[0].kind, 'emotion_tentative');
  const pop_m = sorted.find(function (p) {
    return p.playlist_id === 'lg:v2:mandarin:pop';
  });
  const pop_e = sorted.find(function (p) {
    return p.playlist_id === 'lg:v2:english:pop';
  });
  assert.ok(pop_m && pop_e);
  assert.ok(sorted.indexOf(pop_m) < sorted.indexOf(pop_e));
  const groups = group_playlists_for_ui(sorted);
  assert.equal(groups[0].group_key, 'section:emotion');
  assert.ok(groups.some(function (g) {
    return g.group_key === 'genre:pop';
  }));
});

test('分組摘要不含空群組', function () {
  const list = list_mvp_playlists_for_ui();
  const summary = summarize_playlist_ui_groups(list.playlists);
  let total = 0;
  for (let i = 0; i < summary.length; i += 1) {
    assert.ok(summary[i].count > 0);
    total += summary[i].count;
  }
  assert.equal(total, 42);
});
