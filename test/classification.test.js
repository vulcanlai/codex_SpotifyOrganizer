/**
 * 智慧分類離線測試
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build_merged_track_record } from '../lib/classification/merge_sources.js';
import { classify_decade_tag, parse_release_year, decade_value_from_year } from '../lib/classification/decade.js';
import { classify_track_auto } from '../lib/classification/classify_track.js';
import { apply_manual_overrides_to_tags } from '../lib/classification/apply_overrides.js';
import { build_classification_index } from '../lib/classification/build_index.js';
import {
  load_manual_overrides,
  save_manual_overrides,
  upsert_track_override,
  empty_overrides_doc,
} from '../lib/classification/overrides_store.js';
import { search_classification_tracks } from '../lib/classification/search.js';
import { handle_classification_api } from '../lib/classification/web_handlers.js';
import { write_json_atomic } from '../lib/atomic_json.js';
import { FILE_LIBRARY_V2 } from '../lib/merge/v2/paths.js';
import { FILE_TRACK_CACHE } from '../lib/enrichment/paths.js';
import {
  CLASSIFY_UI_HOST,
  CLASSIFY_UI_PORT,
} from '../classify-ui-server.js';

test('V2 與 enrichment metadata 合併', function () {
  const v2 = {
    spotify_id: 'abc',
    name: null,
    artists: [],
    appearances: [],
  };
  const cache = {
    spotify_id: 'abc',
    status: 'ok',
    name: 'Test Song',
    artists: [{ id: 'a1', name: 'Artist' }],
    album: { id: 'al1', name: 'Album', release_date: '1994-01-01', release_date_precision: 'day' },
  };
  const merged = build_merged_track_record(v2, cache);
  assert.equal(merged.metadata_status, 'complete');
  assert.equal(merged.display.name, 'Test Song');
  assert.equal(merged.merged_metadata.release_date, '1994-01-01');
});

test('缺少 metadata 標記 metadata_missing', function () {
  const merged = build_merged_track_record(
    { spotify_id: 'x', name: null, artists: [], appearances: [] },
    null
  );
  assert.equal(merged.metadata_status, 'metadata_missing');
});

test('相同 Track ID 去重（索引鍵唯一）', function () {
  const built = build_classification_index({ write: false });
  const ids = Object.keys(built.index_doc.tracks_by_id);
  const set = new Set(ids);
  assert.equal(ids.length, set.size);
  assert.equal(ids.length, built.index_doc.track_count);
});

test('年代分類與 release_date_precision', function () {
  const tag = classify_decade_tag({
    merged_metadata: {
      release_date: '2015-06-01',
      release_date_precision: 'day',
    },
  });
  assert.equal(tag.value, '2010s');
  assert.equal(tag.confidence, 'inferred');
  assert.ok(tag.evidence.indexOf('版本發行年代') >= 0);
  assert.equal(parse_release_year('1988'), 1988);
  assert.equal(decade_value_from_year(1988), '1980s');
});

test('多重情境標籤（人工）', function () {
  const auto = classify_track_auto({
    appearances: [],
    merged_metadata: {},
  });
  const applied = apply_manual_overrides_to_tags(auto, {
    contexts: ['懷舊', '開車'],
  });
  const ctx = applied.filter(function (t) {
    return t.dimension === 'context';
  });
  assert.equal(ctx.length, 2);
  assert.equal(ctx[0].is_manual_override, true);
});

test('未確認語言曲風與無自動情境', function () {
  const tags = classify_track_auto({ appearances: [], merged_metadata: {} });
  const lang = tags.find(function (t) {
    return t.dimension === 'language';
  });
  const genre = tags.find(function (t) {
    return t.dimension === 'genre';
  });
  assert.equal(lang.value, '未確認');
  assert.equal(genre.value, '未確認');
  const ctx = tags.filter(function (t) {
    return t.dimension === 'context';
  });
  assert.equal(ctx.length, 0);
});

test('人工覆寫優先於自動', function () {
  const auto = classify_track_auto({ appearances: [], merged_metadata: {} });
  const applied = apply_manual_overrides_to_tags(auto, { language: '國語' });
  const lang = applied.filter(function (t) {
    return t.dimension === 'language';
  });
  assert.equal(lang.length, 1);
  assert.equal(lang[0].value, '國語');
  assert.equal(lang[0].confidence, 'confirmed');
});

test('人工覆寫清除', function () {
  const doc = empty_overrides_doc();
  upsert_track_override(doc, 'tid1', { language: '英文' });
  upsert_track_override(doc, 'tid1', null);
  assert.equal(doc.overrides_by_track_id.tid1, undefined);
});

test('重新 build 保留人工設定', function () {
  const overrides = empty_overrides_doc();
  upsert_track_override(overrides, '00BoQyD7l8sQ6DreBlbD8R', {
    language: '國語',
    source: 'test',
  });
  const first = build_classification_index({
    write: false,
    overrides_doc: overrides,
  });
  const tag = first.index_doc.tracks_by_id['00BoQyD7l8sQ6DreBlbD8R'].tags.find(
    function (t) {
      return t.dimension === 'language';
    }
  );
  assert.equal(tag.value, '國語');
  const second = build_classification_index({
    write: false,
    overrides_doc: overrides,
  });
  const tag2 = second.index_doc.tracks_by_id['00BoQyD7l8sQ6DreBlbD8R'].tags.find(
    function (t) {
      return t.dimension === 'language';
    }
  );
  assert.equal(tag2.value, '國語');
});

test('來源資料 mtime 不變', function () {
  const before_v2 = fs.statSync(FILE_LIBRARY_V2).mtimeMs;
  const before_cache = fs.statSync(FILE_TRACK_CACHE).mtimeMs;
  build_classification_index({ write: false });
  assert.equal(fs.statSync(FILE_LIBRARY_V2).mtimeMs, before_v2);
  assert.equal(fs.statSync(FILE_TRACK_CACHE).mtimeMs, before_cache);
});

test('JSON 原子寫入', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cls-'));
  const file_path = path.join(dir, 'out.json');
  write_json_atomic(file_path, { ok: true });
  const parsed = JSON.parse(fs.readFileSync(file_path, 'utf8'));
  assert.equal(parsed.ok, true);
});

test('UI 搜尋及篩選', function () {
  const built = build_classification_index({ write: false });
  const result = search_classification_tracks(built.index_doc, {
    q: '玫瑰',
    decade: '',
    limit: 10,
    offset: 0,
  });
  assert.ok(result.total >= 1);
  assert.ok(result.items.length >= 1);
  const target_id = result.items[0].spotify_id;
  const located = search_classification_tracks(built.index_doc, {
    q: '玫瑰',
    locate_track_id: target_id,
    locate_page: true,
    limit: 1,
    offset: 0,
  });
  assert.ok(located.located_index >= 0);
  assert.ok(located.items.some(function (row) { return row.spotify_id === target_id; }));
  const excluded = search_classification_tracks(built.index_doc, {
    q: '__不存在的搜尋條件__',
    locate_track_id: target_id,
    limit: 1,
    offset: 0,
  });
  assert.equal(excluded.located_index, -1);
});

test('UI 本機定位回歸：Let It Be Me 直接回傳第 6 頁資料', async function () {
  const track_id = '0V58TmLnChjbNycM9QfFC0';
  const res = await handle_classification_api(
    'GET',
    '/api/tracks',
    '',
    new URLSearchParams(
      'limit=100&offset=0&locate_page=1&locate_track_id=' + track_id
    )
  );
  const data = JSON.parse(res.body);
  assert.equal(data.located_index, 518);
  assert.equal(data.offset, 500);
  assert.equal(Math.floor(data.located_index / 100) + 1, 6);
  assert.ok(data.items.some(function (row) { return row.spotify_id === track_id; }));
});

test('UI API 修改及保存覆寫', async function () {
  const built = build_classification_index({ write: false });
  const track_id = Object.keys(built.index_doc.tracks_by_id).sort()[10];
  try {
    const res = await handle_classification_api(
      'POST',
      '/api/overrides',
      JSON.stringify({
        spotify_id: track_id,
        language: '英文',
        source: 'test',
      })
    );
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    const lang = body.track.tags.find(function (t) {
      return t.dimension === 'language';
    });
    assert.equal(lang.value, '英文');
  } finally {
    const cleanup = load_manual_overrides();
    upsert_track_override(cleanup, track_id, null);
    save_manual_overrides(cleanup);
  }
});

test('本機服務只綁定 127.0.0.1', function () {
  assert.equal(CLASSIFY_UI_HOST, '127.0.0.1');
  assert.equal(CLASSIFY_UI_PORT, 8891);
});

test('build 結果一致（重複執行）', function () {
  const a = build_classification_index({ write: false });
  const b = build_classification_index({ write: false });
  assert.equal(a.summary_doc.track_count, b.summary_doc.track_count);
  assert.deepEqual(a.summary_doc.decade, b.summary_doc.decade);
});

test('完整專輯收藏標籤', function () {
  const tags = classify_track_auto({
    appearances: [{ kind: 'saved_album', source: 'saved_album' }],
    merged_metadata: {},
  });
  const sp = tags.find(function (t) {
    return t.dimension === 'special_type' && t.value === '完整專輯收藏';
  });
  assert.ok(sp);
  assert.equal(sp.confidence, 'confirmed');
});
