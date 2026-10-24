/**
 * MVP Spotify 同步 apply（mock API，不寫入真實 Spotify）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolve_sync_batch_progress,
  should_skip_playlist_as_fully_synced,
  apply_one_mvp_playlist_sync,
  count_newly_added_uris,
  compute_sync_add_plan_hash,
} from '../lib/classification/mvp_playlist_sync_apply.js';
import { compute_track_list_hash } from '../lib/classification/mvp_playlist_sync.js';
import {
  SYNC_STATUS_COMPLETE,
  SYNC_STATUS_INTERRUPTED,
} from '../lib/classification/mvp_playlist_sync_manifest.js';
import { SPOTIFY_ADD_TRACKS_MAX } from '../lib/spotify_playlists_write.js';

function uri(n) {
  return 'spotify:track:' + String(n).padStart(22, '0');
}

function make_pl(uris) {
  const list = uris || [];
  return {
    mvp_playlist_id: 'test:pl',
    spotify_name: 'Test',
    description_zh: 'test',
    track_list_hash: compute_track_list_hash(list),
    valid_uri_count: list.length,
    uris: list,
  };
}

/**
 * @param {string[]} initial_online
 */
function mock_store(initial_online) {
  const online = new Set(initial_online || []);
  /** @type {string[][]} */
  const posts = [];
  return {
    online: online,
    posts: posts,
    fetch: async function () {
      return new Set(online);
    },
    add: async function (_pid, batch) {
      for (let i = 0; i < batch.length; i += 1) {
        online.add(batch[i]);
      }
      posts.push(batch.slice());
    },
  };
}

test('resolve：上次完成 2 批，這次 to_add 僅 1 批須從 0 開始', function () {
  const catalog = [uri(1), uri(2), uri(3)];
  const catalog_hash = compute_track_list_hash(catalog);
  const to_add = [uri(3)];
  const row = {
    sync_status: SYNC_STATUS_COMPLETE,
    sync_target_catalog_hash: catalog_hash,
    sync_add_plan_hash: compute_sync_add_plan_hash([uri(1), uri(2)]),
    add_batches_total: 2,
    add_batches_done: 2,
  };
  const plan = resolve_sync_batch_progress(row, catalog_hash, to_add, SPOTIFY_ADD_TRACKS_MAX);
  assert.equal(plan.batches.length, 1);
  assert.equal(plan.add_batches_done_start, 0);
  assert.equal(plan.checkpoint_reset, true);
});

test('resolve：上次 1 批完成但 add 計畫已變，新 1 批不得跳過', function () {
  const catalog_hash = compute_track_list_hash([uri(1), uri(2)]);
  const to_add = [uri(2)];
  const row = {
    sync_status: SYNC_STATUS_COMPLETE,
    sync_target_catalog_hash: catalog_hash,
    sync_add_plan_hash: compute_sync_add_plan_hash([uri(1)]),
    add_batches_total: 1,
    add_batches_done: 1,
  };
  const plan = resolve_sync_batch_progress(row, catalog_hash, to_add, SPOTIFY_ADD_TRACKS_MAX);
  assert.equal(plan.add_batches_done_start, 0);
  assert.equal(plan.checkpoint_reset, true);
});

test('resolve：相同批次計畫中斷後可續傳', function () {
  const catalog_hash = compute_track_list_hash([uri(1), uri(2), uri(3)]);
  const to_add = [uri(2), uri(3)];
  const add_hash = compute_sync_add_plan_hash(to_add);
  const row = {
    sync_status: SYNC_STATUS_INTERRUPTED,
    sync_target_catalog_hash: catalog_hash,
    sync_add_plan_hash: add_hash,
    add_batches_total: 2,
    add_batches_done: 1,
  };
  const big = [];
  for (let i = 0; i < SPOTIFY_ADD_TRACKS_MAX + 5; i += 1) {
    big.push(uri(100 + i));
  }
  const to_add_big = big.slice();
  const add_hash_big = compute_sync_add_plan_hash(to_add_big);
  row.sync_add_plan_hash = add_hash_big;
  row.add_batches_total = 2;
  const plan = resolve_sync_batch_progress(row, catalog_hash, to_add_big, SPOTIFY_ADD_TRACKS_MAX);
  assert.equal(plan.add_batches_done_start, 1);
  assert.equal(plan.checkpoint_resumed, true);
});

test('should_skip：manifest complete 但線上缺歌不得 skip', function () {
  const uris = [uri(1), uri(2)];
  const pl = make_pl(uris);
  const row = {
    spotify_playlist_id: 'pid',
    sync_status: SYNC_STATUS_COMPLETE,
    track_list_hash: pl.track_list_hash,
  };
  const online = new Set([uri(1)]);
  assert.equal(should_skip_playlist_as_fully_synced(row, pl, online), false);
});

test('apply：manifest complete 但線上缺歌仍會 POST 補齊', async function () {
  const uris = [uri(1), uri(2), uri(3)];
  const pl = make_pl(uris);
  const store = mock_store([uri(1), uri(2)]);
  const row = {
    spotify_playlist_id: '6RekSIw8IY3NbTkdXBYWlD',
    sync_status: SYNC_STATUS_COMPLETE,
    track_list_hash: pl.track_list_hash,
    add_batches_done: 2,
    add_batches_total: 2,
  };
  const result = await apply_one_mvp_playlist_sync(pl, row, {
    fetch_playlist_track_uris: store.fetch,
    add_tracks_to_playlist: store.add,
    verify_read_attempts: 1,
  });
  assert.equal(result.skipped, undefined);
  assert.equal(result.status, SYNC_STATUS_COMPLETE);
  assert.equal(result.added_uris, 1);
  assert.equal(store.posts.length, 1);
  assert.deepEqual(store.posts[0], [uri(3)]);
  assert.equal(row.spotify_playlist_id, '6RekSIw8IY3NbTkdXBYWlD');
});

test('apply：舊 add_batches_done=2 且本輪僅 1 批時仍須 POST（不得假 complete）', async function () {
  const uris = [uri(1), uri(2), uri(3), uri(4)];
  const pl = make_pl(uris);
  const store = mock_store([uri(1), uri(2), uri(3)]);
  const row = {
    spotify_playlist_id: 'pid',
    sync_status: SYNC_STATUS_COMPLETE,
    track_list_hash: pl.track_list_hash,
    add_batches_done: 2,
    add_batches_total: 2,
  };
  const result = await apply_one_mvp_playlist_sync(pl, row, {
    fetch_playlist_track_uris: store.fetch,
    add_tracks_to_playlist: store.add,
    verify_read_attempts: 1,
  });
  assert.equal(result.status, SYNC_STATUS_COMPLETE);
  assert.equal(store.posts.length, 1);
  assert.equal(result.added_uris, 1);
  assert.notEqual(result.added_uris, 4);
});

test('apply：POST 成功但驗證仍缺歌 → interrupted', async function () {
  const uris = [uri(1), uri(2)];
  const pl = make_pl(uris);
  const online = new Set([uri(1)]);
  const row = { spotify_playlist_id: 'pid', sync_status: SYNC_STATUS_INTERRUPTED };
  const result = await apply_one_mvp_playlist_sync(pl, row, {
    fetch_playlist_track_uris: async function () {
      return new Set(online);
    },
    add_tracks_to_playlist: async function (_p, batch) {
      for (let i = 0; i < batch.length; i += 1) {
        online.add(batch[i]);
      }
      online.delete(uri(2));
    },
    verify_read_attempts: 1,
  });
  assert.equal(result.status, SYNC_STATUS_INTERRUPTED);
  assert.equal(row.sync_status, SYNC_STATUS_INTERRUPTED);
});

test('apply：POST 成功且驗證完整才 complete', async function () {
  const uris = [uri(1), uri(2)];
  const pl = make_pl(uris);
  const store = mock_store([uri(1)]);
  const row = { spotify_playlist_id: 'pid' };
  const result = await apply_one_mvp_playlist_sync(pl, row, {
    fetch_playlist_track_uris: store.fetch,
    add_tracks_to_playlist: store.add,
    verify_read_attempts: 1,
  });
  assert.equal(result.status, SYNC_STATUS_COMPLETE);
  assert.equal(result.added_uris, 1);
  assert.equal(row.sync_status, SYNC_STATUS_COMPLETE);
});

test('apply：重跑不得重複 POST 已在線上的 URI', async function () {
  const uris = [uri(1), uri(2)];
  const pl = make_pl(uris);
  const store = mock_store(uris);
  const row = {
    spotify_playlist_id: '3INMJ3O28lbwY7ENFsHoir',
    sync_status: SYNC_STATUS_COMPLETE,
    track_list_hash: pl.track_list_hash,
  };
  const result = await apply_one_mvp_playlist_sync(pl, row, {
    fetch_playlist_track_uris: store.fetch,
    add_tracks_to_playlist: store.add,
    verify_read_attempts: 1,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'already_complete_verified');
  assert.equal(store.posts.length, 0);
  assert.equal(row.spotify_playlist_id, '3INMJ3O28lbwY7ENFsHoir');
});

test('count_newly_added_uris 只計本次 POST 後新出現的 URI', function () {
  const before = new Set([uri(1)]);
  const after = new Set([uri(1), uri(2)]);
  const n = count_newly_added_uris(before, after, [uri(2), uri(3)]);
  assert.equal(n, 1);
});
