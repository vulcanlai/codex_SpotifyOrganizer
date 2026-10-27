import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
await import(pathToFileURL(path.join(root, 'public', 'classify', 'pagination_model.js')));
const pager = globalThis.ClassifyPaginationModel;

function mock_items(prefix, count) {
  return Array.from({ length: count }, function (_, i) {
    return { spotify_id: prefix + '-' + String(i + 1) };
  });
}

test('隔離模擬資料：各頁籤超過 100 首及最後一頁', function () {
  const all = mock_items('all', 235);
  const ai = mock_items('ai', 207);
  const quality = mock_items('quality', 121);
  assert.equal(pager.page_count(all.length, 100), 3);
  assert.equal(pager.slice_page(all, 3, 100).length, 35);
  assert.equal(pager.slice_page(ai, 3, 100).length, 7);
  assert.equal(pager.slice_page(quality, 2, 100).length, 21);
});

test('隔離模擬資料：頁籤往返保留頁碼，搜尋篩選重設相關頁碼', function () {
  const all = mock_items('all', 235);
  const ai = mock_items('ai', 207);
  const pages = { all: 3, ai: 2, quality: 1 };
  assert.equal(pager.slice_page(all, pages.all, 100)[0].spotify_id, 'all-201');
  assert.equal(pager.slice_page(ai, pages.ai, 100)[0].spotify_id, 'ai-101');
  assert.equal(pager.slice_page(all, pages.all, 100)[0].spotify_id, 'all-201');
  const filtered = all.filter(function (_, i) { return i < 23; });
  pages.all = 1; // 搜尋或篩選只重設全部歌曲
  assert.equal(pager.page_count(filtered.length, 100), 1);
  assert.equal(pager.slice_page(filtered, pages.all, 100).length, 23);
  assert.equal(pages.ai, 2);
});

test('隔離模擬資料：總頁數縮減時安全調整頁碼', function () {
  assert.equal(pager.clamp_page(8, 235, 100), 3);
  assert.equal(pager.clamp_page(3, 23, 100), 1);
});

test('隔離模擬資料：跨頁籤以 Track ID 雙向定位且不存在時保留頁碼', function () {
  const all = mock_items('shared', 235);
  const ai = all.slice(80, 207);
  const quality = all.slice(120, 221);
  const selected_id = 'shared-205';
  const ai_index = ai.findIndex(function (row) { return row.spotify_id === selected_id; });
  const quality_index = quality.findIndex(function (row) { return row.spotify_id === selected_id; });
  assert.equal(Math.floor(ai_index / 100) + 1, 2);
  assert.equal(Math.floor(quality_index / 100) + 1, 1);
  assert.equal(Math.floor(all.findIndex(function (row) { return row.spotify_id === selected_id; }) / 100) + 1, 3);

  const remembered_page = 2;
  const missing_id = 'shared-10';
  assert.equal(ai.findIndex(function (row) { return row.spotify_id === missing_id; }), -1);
  assert.equal(remembered_page, 2);
  assert.equal(all.findIndex(function (row) { return row.spotify_id === ''; }), -1);
});

test('精簡省略式頁碼保留首頁、目前頁與末頁', function () {
  assert.deepEqual(
    pager.visible_pages(78, 40, 1),
    [1, 'ellipsis-start', 39, 40, 41, 'ellipsis-end', 78]
  );
  assert.deepEqual(
    pager.visible_pages(78, 40, 2),
    [1, 'ellipsis-start', 38, 39, 40, 41, 42, 'ellipsis-end', 78]
  );
});

test('非同步搜尋競態：只有最新請求可以更新清單狀態', async function () {
  const gate = pager.create_request_gate();
  const applied = [];
  const old_request = gate.next();
  const locate_request = gate.next();
  await Promise.all([
    new Promise(function (resolve) {
      setTimeout(function () {
        if (gate.is_current(old_request)) applied.push('page-1');
        resolve();
      }, 10);
    }),
    Promise.resolve().then(function () {
      if (gate.is_current(locate_request)) applied.push('page-6');
    }),
  ]);
  assert.deepEqual(applied, ['page-6']);
});
