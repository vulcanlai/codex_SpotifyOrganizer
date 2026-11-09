/**
 * 🎵 納管歌單讀回／保存／同步尊重／ZIP 關係層（離線合成資料，不碰正式 Token）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SpotifyRequestError } from '../lib/spotify_api.js';
import { is_managed_playlist_name, classify_playlist_capability, is_pending_absence_status } from '../lib/managed_playlists/identity.js';
import { normalize_playlist_items, diff_playlist_items, possible_moves_from_diffs } from '../lib/managed_playlists/items.js';
import { should_fetch_items, run_managed_playlist_readback, normalize_list_playlist, seed_baseline_from_manifest, checkpoint_pack_matches_live, pack_items_usable } from '../lib/managed_playlists/readback.js';
import { diff_managed_playlists, catalog_track_ids_by_spotify_id, inferred_catalog_membership } from '../lib/managed_playlists/diff.js';
import { build_readback_plan, validate_plan_for_apply, fingerprint_baseline } from '../lib/managed_playlists/plan.js';
import { apply_managed_playlist_plan } from '../lib/managed_playlists/apply_local.js';
import { managed_playlist_paths, MANAGED_PLAYLIST_APPLY_TOKEN } from '../lib/managed_playlists/constants.js';
import { empty_baseline, empty_rules, empty_operations, load_rules, load_baseline } from '../lib/managed_playlists/stores.js';
import {
  apply_human_rules_to_sync_playlist,
  apply_human_rules_to_metadata_change,
  filter_uris_by_human_removals,
  resolved_sync_name,
  human_removed_ids_by_mvp_id,
} from '../lib/managed_playlists/sync_respect.js';
import { build_relation_merge_plan, apply_relation_merge_to_library } from '../lib/managed_playlists/zip_relation_merge.js';
import { cleanup_import_safety } from '../lib/data_sync/cleanup_import_safety.js';
import { should_exclude_relative_path } from '../lib/data_sync/export_profile_minimal.js';
import { build_mvp_sync_plan } from '../lib/classification/mvp_playlist_sync.js';
import { build_mvp_playlist_catalog } from '../lib/classification/mvp_smart_playlists.js';

const P1 = '1111111111111111111111';
const P2 = '2222222222222222222222';
const P3 = '3333333333333333333333';
const T1 = 'AAAAAAAAAAAAAAAAAAAAAA';
const T2 = 'BBBBBBBBBBBBBBBBBBBBBB';
const T3 = 'CCCCCCCCCCCCCCCCCCCCCC';
const EX = 'DDDDDDDDDDDDDDDDDDDDDD';
const P404 = '4444444444444444444444';
const PNEW = '5555555555555555555555';
const USER = 'offline-user-aaaaaaaaaa';
const EMPTY_MANIFEST = { playlists: {} };
const LIVE_FP = 'live-fingerprint-for-apply-tests';

function tmp_root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'so-managed-'));
}

function file_sha256_or_null(file_path) {
  if (!fs.existsSync(file_path)) {
    return null;
  }
  return crypto.createHash('sha256').update(fs.readFileSync(file_path)).digest('hex');
}

const OFFICIAL_RULES = path.join(process.cwd(), 'backup/classification/managed-playlist-rules.json');
const OFFICIAL_BASELINE = path.join(process.cwd(), 'backup/classification/managed-playlist-baseline.json');

function assert_isolated_apply_did_not_touch_official(root, paths) {
  assert.equal(path.resolve(paths.rules).startsWith(path.resolve(root)), true);
  assert.notEqual(path.resolve(paths.rules), path.resolve(OFFICIAL_RULES));
}

function track_item(id, name) {
  return { track: { id: id, uri: 'spotify:track:' + id, type: 'track', name: name || id, artists: [{ name: 'A' }], is_local: false } };
}

function list_pl(id, name, snapshot, total) {
  return { id: id, name: name, snapshot_id: snapshot, collaborative: false, owner: { id: USER }, tracks: { total: total || 0 } };
}

function mock_get(table) {
  return async function (url) {
    const key = String(url);
    const matches = Object.keys(table)
      .filter(function (match) {
        return key.indexOf(match) >= 0;
      })
      .sort(function (a, b) {
        return b.length - a.length;
      });
    if (!matches.length) {
      throw new SpotifyRequestError('not found ' + key, 404);
    }
    const value = table[matches[0]];
    if (typeof value === 'function') {
      return value(key);
    }
    if (value instanceof Error) {
      throw value;
    }
    return value;
  };
}

test('名稱去空白後以 🎵 開頭才納管，身分用 ID', function () {
  assert.equal(is_managed_playlist_name('🎵 華語流行'), true);
  assert.equal(is_managed_playlist_name('  🎵 台語歌手 / 年代'), true);
  assert.equal(is_managed_playlist_name('華語流行'), false);
  assert.equal(classify_playlist_capability({ listed_in_me: false, http_status: 404 }).status, 'deleted_pending');
  assert.equal(classify_playlist_capability({ listed_in_me: false, http_status: 403 }).status, 'permission_changed_pending');
  assert.equal(classify_playlist_capability({ listed_in_me: false, direct_ok: true, name: '🎵 x' }).status, 'unfollowed_pending');
  assert.equal(classify_playlist_capability({ listed_in_me: true, name: '舊名', owner_id: USER, me_id: USER }).status, 'prefix_removed_pending');
  assert.equal(classify_playlist_capability({ listed_in_me: true, name: '🎵 x', owner_id: 'other', me_id: USER }).can_edit, false);
});

test('重複曲目與順序、local／無效不當作已刪除', function () {
  const items = normalize_playlist_items([
    track_item(T1, 'One'),
    { item: { id: T1, uri: 'spotify:track:' + T1, type: 'track', name: 'One', artists: [{ name: 'A' }], is_local: false } },
    { track: { is_local: true, name: 'Local', uri: 'spotify:local:x', artists: [] } },
    { item: null },
  ]);
  assert.equal(items[0].occurrence, 1);
  assert.equal(items[1].occurrence, 2);
  assert.equal(items[2].kind, 'local');
  assert.equal(items[3].kind, 'unavailable');
  const diff = diff_playlist_items(items, [items[1], items[0], items[2], items[3]]);
  assert.equal(diff.order_changed, true);
  assert.equal(diff.added.length, 0);
});

test('跨歌單移動只展示不偽造', function () {
  const moves = possible_moves_from_diffs([
    { spotify_playlist_id: P1, items_diff: { removed: [{ track_id: T1 }], added: [] } },
    { spotify_playlist_id: P2, items_diff: { removed: [], added: [{ track_id: T1 }] } },
  ]);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].proven, false);
});

test('無正式基準時以 sync-manifest 辨識既有🎵，只有新歌單當新建', function () {
  const seeded = seed_baseline_from_manifest({
    playlists: { 'lg:v2:mandarin:pop': { spotify_playlist_id: P1, spotify_name: '🎵 舊自動' } },
  });
  const diff = diff_managed_playlists(
    seeded,
    [
      normalize_list_playlist(list_pl(P1, '🎵 人工新名', 's1', 1)),
      normalize_list_playlist(list_pl(P2, '🎵 台語歌手 / 年代', 'n1', 1)),
    ],
    {
      [P1]: { items: normalize_playlist_items([track_item(T1)]), items_complete: true },
      [P2]: { items: normalize_playlist_items([track_item(T2)]), items_complete: true },
    },
    { me_id: USER }
  );
  const old = diff.playlists.find((p) => p.spotify_playlist_id === P1);
  const neu = diff.playlists.find((p) => p.spotify_playlist_id === P2);
  assert.equal(old.is_new, false);
  assert.equal(old.name_changed, true);
  assert.equal(old.items_diff.added.length, 0);
  assert.equal(neu.is_new, true);
  assert.equal(neu.items_diff.added.length, 1);
});

test('未變更略過曲目重抓；snapshot 變動才抓', function () {
  const live = normalize_list_playlist(list_pl(P1, '🎵 A', 'snap-2', 2));
  assert.equal(should_fetch_items(live, { snapshot_id: 'snap-2', items: [], items_complete: true }), false);
  assert.equal(should_fetch_items(live, { snapshot_id: 'snap-1', items: [], items_complete: true }), true);
  assert.equal(should_fetch_items(live, null), true);
  assert.equal(should_fetch_items(normalize_list_playlist(list_pl(P1, '普通', 'snap-3', 1)), { snapshot_id: 'x' }), false);
});

test('讀回：改名同 ID、新建自訂、未變更沿用基準、排除衝突', async function () {
  const root = tmp_root();
  const paths = managed_playlist_paths(root);
  const baseline = empty_baseline(USER);
  baseline.playlists[P1] = {
    name: '🎵 舊名',
    snapshot_id: 's1',
    items: normalize_playlist_items([track_item(T1)]),
    items_complete: true,
    kind: 'template',
  };
  const result = await run_managed_playlist_readback({
    paths: paths,
    baseline: baseline,
    rules: empty_rules(USER),
    excluded_track_ids: [EX],
    get_json: mock_get({
      '/me': { id: USER },
      '/me/playlists': {
        items: [
          list_pl(P1, '🎵 新名', 's1', 1),
          list_pl(P2, '🎵 台語歌手 / 年代', 'n1', 2),
          list_pl(P3, '他人來源', 'x', 9),
        ],
        next: null,
      },
      ['/playlists/' + P2 + '?']: { id: P2, name: '🎵 台語歌手 / 年代', snapshot_id: 'n1', collaborative: false, owner: { id: USER }, tracks: { total: 2 } },
      ['/playlists/' + P2 + '/items']: {
        items: [track_item(T2, 'New'), track_item(EX, 'Excluded')],
        next: null,
      },
    }),
  });
  assert.equal(result.applied, false);
  const renamed = result.plan.playlists.find((p) => p.spotify_playlist_id === P1);
  const created = result.plan.playlists.find((p) => p.spotify_playlist_id === P2);
  assert.equal(renamed.name_changed, true);
  assert.equal(renamed.skipped_unchanged, false);
  assert.equal(result.read_cost.playlists_reused_baseline, 1);
  assert.equal(created.is_new, true);
  assert.equal(created.conflicts.some((c) => c.type === 'excluded_track_readded'), true);
  assert.equal(result.plan.playlists.some((p) => p.spotify_playlist_id === P3), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('讀取中 snapshot 再變不得當完整快照；checkpoint 可恢復', async function () {
  const root = tmp_root();
  const paths = managed_playlist_paths(root);
  let detail_calls = 0;
  const result = await run_managed_playlist_readback({
    paths: paths,
    baseline: empty_baseline(USER),
    manifest: EMPTY_MANIFEST,
    get_json: mock_get({
      '/me': { id: USER },
      '/me/playlists': { items: [list_pl(P1, '🎵 A', 'before', 1)], next: null },
      ['/playlists/' + P1 + '?']: function () {
        detail_calls += 1;
        return {
          id: P1,
          name: '🎵 A',
          snapshot_id: detail_calls < 2 ? 'before' : 'after',
          collaborative: false,
          owner: { id: USER },
          tracks: { total: 1 },
        };
      },
      ['/playlists/' + P1 + '/items']: { items: [track_item(T1)], next: null },
    }),
  });
  assert.equal(result.plan.playlists[0].changed_during_read, true);
  assert.equal(result.plan.playlists[0].incomplete, true);
  const denied = apply_managed_playlist_plan({
    paths: paths,
    plan: result.plan,
    confirm: MANAGED_PLAYLIST_APPLY_TOKEN,
    template_spotify_ids: new Set(),
  });
  assert.equal(denied.ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('429／403／404／網路／授權可區分', async function () {
  const cases = [
    [429, true, 'rate_limited'],
    [403, false, 'forbidden'],
    [404, false, 'not_found'],
    [401, true, 'unauthorized'],
  ];
  for (const [status, stop] of cases) {
    const root = tmp_root();
    const result = await run_managed_playlist_readback({
      paths: managed_playlist_paths(root),
      baseline: empty_baseline(USER),
      manifest: EMPTY_MANIFEST,
      get_json: mock_get({
        '/me': { id: USER },
        '/me/playlists': { items: [list_pl(P1, '🎵 A', 's', 1)], next: null },
        ['/playlists/' + P1]: new SpotifyRequestError('x', status, {}, status === 429 ? 30 : undefined),
      }),
    });
    assert.equal(result.read_cost.errors[0].http_status, status);
    assert.equal(result.read_cost.errors[0].stop_all, stop);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('確認保存：改名鎖定、移除不回補、新曲可見來源、過期與重複 plan', async function () {
  const root = tmp_root();
  const paths = managed_playlist_paths(root);
  const plan = build_readback_plan({
    account_id: USER,
    baseline_fingerprint: fingerprint_baseline(empty_baseline(USER)),
    diff: {
      playlists: [
        {
          spotify_playlist_id: P1,
          previous_name: '🎵 舊',
          current_name: '🎵 新',
          name_changed: true,
          snapshot_id_after: 's2',
          is_new: false,
          kind: 'template',
          status: 'active',
          can_edit: true,
          items_complete: true,
          items: normalize_playlist_items([track_item(T2, 'Added')]),
          items_diff: {
            added: normalize_playlist_items([track_item(T2, 'Added')]),
            removed: [{ track_id: T1, kind: 'track', occurrence: 1 }],
            order_changed: false,
            repeat_counts: {},
          },
        },
      ],
      possible_moves: [],
    },
  });
  const first = apply_managed_playlist_plan({
    paths: paths,
    plan: plan,
    confirm: MANAGED_PLAYLIST_APPLY_TOKEN,
    rules: empty_rules(USER),
    baseline: empty_baseline(USER),
    operations: empty_operations(),
    template_spotify_ids: new Set([P1]),
  });
  assert.equal(first.ok, true);
  const rules = load_rules({ paths: paths });
  assert.equal(rules.playlists[P1].retained_name, '🎵 新');
  assert.equal(rules.playlists[P1].name_locked, true);
  assert.ok(rules.playlists[P1].removed_track_ids.includes(T1));
  assert.ok(rules.additional_track_index_by_id[T2]);
  assert.equal(rules.additional_track_index_by_id[T2].metadata_complete, false);
  const dup = apply_managed_playlist_plan({
    paths: paths,
    plan: plan,
    confirm: MANAGED_PLAYLIST_APPLY_TOKEN,
    template_spotify_ids: new Set([P1]),
  });
  assert.equal(dup.ok, false);
  const stale = build_readback_plan({
    account_id: USER,
    baseline_fingerprint: 'old',
    diff: { playlists: [], possible_moves: [] },
  });
  assert.equal(
    validate_plan_for_apply(stale, { current_baseline_fingerprint: 'new' }).ok,
    false
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('兩種 Spotify 同步入口尊重人工名稱與移除；自訂歌單不套模板', function () {
  const rules = empty_rules(USER);
  rules.playlists[P1] = {
    spotify_playlist_id: P1,
    kind: 'template',
    retained_name: '🎵 人工名',
    name_locked: true,
    removed_track_ids: [T1],
  };
  const manifest = { playlists: { 'lg:v2:mandarin:pop': { spotify_playlist_id: P1, spotify_name: '🎵 舊自動' } } };
  const catalog = {
    language_genre_playlists: [
      {
        playlist_id: 'lg:v2:mandarin:pop',
        kind: 'language_genre',
        primary_genre: 'pop',
        language_bucket: 'mandarin',
        label_zh: '華語流行音樂',
        track_ids: [T1, T2],
        track_count: 2,
      },
    ],
    emotion_playlists_tentative: [],
  };
  const index_doc = { tracks_by_id: { [T1]: {}, [T2]: {} } };
  const plan = build_mvp_sync_plan(catalog, index_doc, { rules: rules, manifest: manifest });
  assert.equal(plan.playlists[0].spotify_name, '🎵 人工名');
  assert.equal(plan.playlists[0].uris.some((u) => u.indexOf(T1) >= 0), false);
  assert.equal(plan.playlists[0].uris.some((u) => u.indexOf(T2) >= 0), true);
  const change = apply_human_rules_to_metadata_change({
    spotify_playlist_id: P1,
    target_name: '🎵 自動名',
    update_name: true,
    update_description: false,
  }, rules);
  assert.equal(change.update_name, false);
  assert.equal(resolved_sync_name('🎵 自動', rules.playlists[P1]), '🎵 人工名');
  assert.deepEqual(filter_uris_by_human_removals(['spotify:track:' + T1, 'spotify:track:' + T2], rules.playlists[P1]), [
    'spotify:track:' + T2,
  ]);
});

test('classify catalog 重建不把人工刪歌加回', function () {
  const removed = { 'lg:v2:mandarin:pop': new Set([T1]) };
  const catalog = build_mvp_playlist_catalog(
    {
      tracks_by_id: {
        [T1]: {
          display: { name: 'Gone' },
          tags: [{ dimension: 'language', value: '華語' }],
          genre_profile: { primary_genre: 'pop' },
        },
        [T2]: {
          display: { name: 'Stay' },
          tags: [{ dimension: 'language', value: '華語' }],
          genre_profile: { primary_genre: 'pop' },
        },
      },
    },
    { human_removed_by_mvp: removed }
  );
  const pl = catalog.language_genre_playlists.find((p) => p.playlist_id === 'lg:v2:mandarin:pop');
  if (pl) {
    assert.equal(pl.track_ids.includes(T1), false);
  }
});

test('ZIP：公司移除不復活、家裡獨有保護、雙端衝突、無共同基準阻擋', function () {
  const rel = (pid, id, pos) => ({
    kind: 'playlist',
    container_id: pid,
    spotify_id: id,
    position: pos,
  });
  function lib(rows) {
    const track_index_by_spotify_id = {};
    const playlist_track_entries = [];
    for (const r of rows) {
      playlist_track_entries.push({ spotify_id: r.spotify_id, playlist_id: r.container_id, position: r.position });
      track_index_by_spotify_id[r.spotify_id] = track_index_by_spotify_id[r.spotify_id] || {
        spotify_id: r.spotify_id,
        appearances: [],
      };
      track_index_by_spotify_id[r.spotify_id].appearances.push({
        kind: 'playlist',
        playlist_id: r.container_id,
        position: r.position,
      });
    }
    return {
      schema_version: 2,
      user_id: USER,
      playlist_track_entries,
      liked_tracks: [],
      saved_albums: [],
      track_index_by_spotify_id,
    };
  }
  const baseline = lib([rel(P1, T1, 0), rel(P1, T2, 1)]);
  const company = lib([rel(P1, T2, 1), rel(P2, T3, 0)]);
  const home = lib([rel(P1, T1, 0), rel(P1, T2, 1), rel(P1, T3, 2)]);
  const ledger = {
    schema_version: 1,
    user_id: USER,
    events: [
      {
        kind: 'playlist',
        container_id: P1,
        spotify_id: T1,
        action: 'remove',
        status: 'applied_verified',
        operation_id: 'op1',
        verified_at: '2026-11-06T00:00:00.000Z',
        source_bundle_id: 'b1',
      },
    ],
  };
  const blocked = build_relation_merge_plan({ local: home, incoming: company, ledger: ledger });
  assert.equal(blocked.allow_apply, false);
  const ok = build_relation_merge_plan({
    local: home,
    incoming: company,
    ledger: ledger,
    baseline: baseline,
    common_baseline_ok: true,
  });
  assert.equal(ok.auto_remove.some((r) => r.spotify_id === T1), true);
  assert.equal(ok.protect_local.some((r) => r.spotify_id === T3 && r.container_id === P1), true);
  assert.equal(ok.auto_add.some((r) => r.spotify_id === T3 && r.container_id === P2), true);
  const merged = apply_relation_merge_to_library(home, { ...ok, allow_apply: true });
  assert.equal(
    merged.playlist_track_entries.some((x) => x.spotify_id === T1 && x.playlist_id === P1),
    false
  );
  assert.equal(
    merged.playlist_track_entries.some((x) => x.spotify_id === T3 && x.playlist_id === P1),
    true
  );
  const conflict_home = lib([rel(P1, T1, 5), rel(P1, T2, 1)]);
  const conflict = build_relation_merge_plan({
    local: conflict_home,
    incoming: company,
    ledger: ledger,
    baseline: baseline,
    common_baseline_ok: true,
  });
  assert.ok(conflict.conflicts.length >= 1);
});

test('安全閘：ledger 仍擋整檔；讀回快取不進 ZIP', function () {
  const root = tmp_root();
  const local = path.join(root, 'local');
  const incoming = path.join(root, 'incoming');
  const lib = {
    schema_version: 2,
    user_id: USER,
    playlist_track_entries: [],
    liked_tracks: [],
    saved_albums: [],
    track_index_by_spotify_id: {},
  };
  fs.mkdirSync(path.join(local, 'backup/merged'), { recursive: true });
  fs.mkdirSync(path.join(incoming, 'backup/merged'), { recursive: true });
  fs.mkdirSync(path.join(local, 'backup/library'), { recursive: true });
  fs.writeFileSync(path.join(local, 'backup/merged/library-v2.json'), JSON.stringify(lib));
  fs.writeFileSync(path.join(incoming, 'backup/merged/library-v2.json'), JSON.stringify(lib));
  fs.writeFileSync(
    path.join(local, 'backup/library/cleanup-ledger.json'),
    JSON.stringify({ schema_version: 1, user_id: USER, events: [] })
  );
  const safety = cleanup_import_safety(local, incoming);
  assert.equal(safety.allow_apply, false);
  assert.equal(safety.allow_whole_file, false);
  assert.equal(should_exclude_relative_path('backup/classification/managed-playlists-readback/plans/x.json'), true);
  assert.equal(should_exclude_relative_path('backup/classification/managed-playlist-rules.json'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('snapshot 分頁讀完整頁；checkpoint 恢復略過已完成歌單', async function () {
  const root = tmp_root();
  const paths = managed_playlist_paths(root);
  const pages = [];
  const result = await run_managed_playlist_readback({
    paths: paths,
    baseline: empty_baseline(USER),
    manifest: EMPTY_MANIFEST,
    resume: true,
    get_json: mock_get({
      '/me': { id: USER },
      '/me/playlists': { items: [list_pl(P1, '🎵 A', 's', 2)], next: null },
      ['/playlists/' + P1 + '?']: {
        id: P1,
        name: '🎵 A',
        snapshot_id: 's',
        collaborative: false,
        owner: { id: USER },
        tracks: { total: 2 },
      },
      ['/playlists/' + P1 + '/items']: function (url) {
        pages.push(url);
        if (url.indexOf('page2') >= 0) {
          return { items: [track_item(T2)], next: null };
        }
        return { items: [track_item(T1)], next: '/playlists/' + P1 + '/items?page2=1' };
      },
    }),
  });
  assert.equal(result.plan.playlists[0].items.length, 2);
  assert.equal(pages.length, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('部分保存失敗還原，不留半套規則', function () {
  const root = tmp_root();
  const paths = managed_playlist_paths(root);
  fs.mkdirSync(paths.plans_dir, { recursive: true });
  const plan = build_readback_plan({
    account_id: USER,
    baseline_fingerprint: fingerprint_baseline(empty_baseline(USER)),
    diff: {
      playlists: [
        {
          spotify_playlist_id: P1,
          current_name: '🎵 X',
          status: 'active',
          can_edit: true,
          items_complete: true,
          items: [],
          items_diff: { added: [], removed: [], order_changed: false, repeat_counts: {} },
        },
      ],
      possible_moves: [],
    },
  });
  const original_rename = fs.renameSync;
  let writes = 0;
  fs.renameSync = function (from, to) {
    writes += 1;
    if (writes === 2) {
      throw new Error('simulated write fail');
    }
    return original_rename.call(fs, from, to);
  };
  try {
    const result = apply_managed_playlist_plan({
      paths: paths,
      plan: plan,
      confirm: MANAGED_PLAYLIST_APPLY_TOKEN,
      rules: empty_rules(USER),
      baseline: empty_baseline(USER),
      operations: empty_operations(),
      template_spotify_ids: new Set(),
    });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(paths.rules), false);
  } finally {
    fs.renameSync = original_rename;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('去前綴與他人只讀狀態不可互相推定', function () {
  const prefix = classify_playlist_capability({
    listed_in_me: true,
    name: '台語歌手 / 年代',
    owner_id: USER,
    me_id: USER,
  });
  const foreign = classify_playlist_capability({
    listed_in_me: true,
    name: '🎵 他人',
    owner_id: 'someoneelseaaaaaaaaaa',
    me_id: USER,
    collaborative: true,
  });
  assert.equal(prefix.status, 'prefix_removed_pending');
  assert.notEqual(prefix.status, foreign.status);
  assert.equal(foreign.can_edit, false);
});

function detail_pl(id, name, snapshot, total) {
  return {
    id: id,
    name: name,
    snapshot_id: snapshot,
    collaborative: false,
    owner: { id: USER },
    tracks: { total: total || 0 },
  };
}

function write_cache_pack(paths, id, name, snapshot, items, extra) {
  fs.mkdirSync(paths.cache_items_dir, { recursive: true });
  const pack = {
    meta: { name: name, snapshot_id: snapshot, collaborative: false, owner_id: USER },
    items: items,
    items_complete: true,
    changed_during_read: false,
    ...(extra || {}),
  };
  fs.writeFileSync(path.join(paths.cache_items_dir, id + '.json'), JSON.stringify(pack));
  return pack;
}

test('無 snapshot_id 不得用曲目數相同略過；全 unavailable 快取不可用', function () {
  const live = normalize_list_playlist(list_pl(P1, '🎵 A', null, 2));
  assert.equal(should_fetch_items(live, { snapshot_id: 's', items: [normalize_playlist_items([track_item(T1)])[0]], items_complete: true }), true);
  assert.equal(
    pack_items_usable({
      items: [{ kind: 'unavailable' }, { kind: 'unavailable' }],
      items_complete: true,
    }),
    false
  );
  assert.equal(
    checkpoint_pack_matches_live(
      { items: normalize_playlist_items([track_item(T1)]), items_complete: true, snapshot_id: 'old' },
      normalize_list_playlist(list_pl(P1, '🎵 A', 'new', 1))
    ),
    false
  );
});

test('增量：首次基準後未變更不重抓；只抓 snapshot 變的那一份', async function () {
  const root = tmp_root();
  const paths = managed_playlist_paths(root);
  const baseline = empty_baseline(USER);
  baseline.playlists[P1] = {
    name: '🎵 A',
    snapshot_id: 's1',
    items: normalize_playlist_items([track_item(T1)]),
    items_complete: true,
    kind: 'template',
  };
  baseline.playlists[P2] = {
    name: '🎵 B',
    snapshot_id: 't1',
    items: normalize_playlist_items([track_item(T2)]),
    items_complete: true,
    kind: 'template',
  };
  let fetched = [];
  const result = await run_managed_playlist_readback({
    paths: paths,
    baseline: baseline,
    rules: empty_rules(USER),
    get_json: mock_get({
      '/me': { id: USER },
      '/me/playlists': {
        items: [list_pl(P1, '🎵 A', 's1', 1), list_pl(P2, '🎵 B', 't2', 1)],
        next: null,
      },
      ['/playlists/' + P2 + '?']: detail_pl(P2, '🎵 B', 't2', 1),
      ['/playlists/' + P2 + '/items']: function () {
        fetched.push(P2);
        return { items: [track_item(T3)], next: null };
      },
      ['/playlists/' + P1 + '?']: function () {
        fetched.push(P1);
        return detail_pl(P1, '🎵 A', 's1', 1);
      },
      ['/playlists/' + P1 + '/items']: function () {
        fetched.push('p1-items');
        return { items: [track_item(T1)], next: null };
      },
    }),
  });
  assert.equal(result.read_cost.playlists_reused_baseline, 1);
  assert.equal(result.read_cost.playlists_item_fetched, 1);
  assert.equal(fetched.includes(P1), false);
  assert.equal(fetched.includes('p1-items'), false);
  const changed = result.plan.playlists.find((p) => p.spotify_playlist_id === P2);
  assert.equal(changed.snapshot_changed, true);
  assert.equal(changed.removed.some((x) => x.track_id === T2), true);
  assert.equal(changed.added.some((x) => x.track_id === T3), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('增量：改名同 ID 不新建且不重抓曲目', async function () {
  const root = tmp_root();
  const paths = managed_playlist_paths(root);
  const baseline = empty_baseline(USER);
  baseline.playlists[P1] = {
    name: '🎵 舊自動',
    snapshot_id: 's1',
    items: normalize_playlist_items([track_item(T1)]),
    items_complete: true,
    kind: 'template',
  };
  const result = await run_managed_playlist_readback({
    paths: paths,
    baseline: baseline,
    rules: empty_rules(USER),
    get_json: mock_get({
      '/me': { id: USER },
      '/me/playlists': { items: [list_pl(P1, '🎵 華語 / 中國風', 's1', 1)], next: null },
    }),
  });
  assert.equal(result.read_cost.playlists_item_fetched, 0);
  assert.equal(result.plan.playlists[0].is_new, false);
  assert.equal(result.plan.playlists[0].name_changed, true);
  assert.equal(result.plan.playlists[0].current_name, '🎵 華語 / 中國風');
  fs.rmSync(root, { recursive: true, force: true });
});

test('舊 checkpoint 與 live snapshot 不符則重抓；相符則沿用', async function () {
  const root = tmp_root();
  const paths = managed_playlist_paths(root);
  fs.mkdirSync(paths.readback_dir, { recursive: true });
  const good = normalize_playlist_items([track_item(T1)]);
  write_cache_pack(paths, P1, '🎵 A', 'old', good);
  fs.writeFileSync(
    paths.checkpoint,
    JSON.stringify({
      account_id: USER,
      live_items_by_id: { [P1]: { items: good, items_complete: true } },
    })
  );
  let fetched = 0;
  const result = await run_managed_playlist_readback({
    paths: paths,
    baseline: empty_baseline(USER),
    rules: empty_rules(USER),
    manifest: EMPTY_MANIFEST,
    resume: true,
    get_json: mock_get({
      '/me': { id: USER },
      '/me/playlists': { items: [list_pl(P1, '🎵 A', 'new', 1)], next: null },
      ['/playlists/' + P1 + '?']: detail_pl(P1, '🎵 A', 'new', 1),
      ['/playlists/' + P1 + '/items']: function () {
        fetched += 1;
        return { items: [track_item(T2)], next: null };
      },
    }),
  });
  assert.equal(fetched, 1);
  assert.equal(result.plan.playlists[0].items[0].track_id, T2);

  fetched = 0;
  const result2 = await run_managed_playlist_readback({
    paths: paths,
    baseline: empty_baseline(USER),
    rules: empty_rules(USER),
    manifest: EMPTY_MANIFEST,
    resume: true,
    get_json: mock_get({
      '/me': { id: USER },
      '/me/playlists': { items: [list_pl(P1, '🎵 A', 'new', 1)], next: null },
      ['/playlists/' + P1 + '/items']: function () {
        fetched += 1;
        return { items: [track_item(T3)], next: null };
      },
    }),
  });
  assert.equal(fetched, 0);
  assert.equal(result2.read_cost.playlists_reused_checkpoint, 1);
  assert.equal(result2.plan.playlists[0].items[0].track_id, T2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('全 unavailable 舊快取即使 snapshot 相同也要重抓', async function () {
  const root = tmp_root();
  const paths = managed_playlist_paths(root);
  write_cache_pack(paths, P1, '🎵 A', 's1', [{ kind: 'unavailable', track_id: null }]);
  let fetched = 0;
  const result = await run_managed_playlist_readback({
    paths: paths,
    baseline: empty_baseline(USER),
    rules: empty_rules(USER),
    manifest: EMPTY_MANIFEST,
    resume: true,
    get_json: mock_get({
      '/me': { id: USER },
      '/me/playlists': { items: [list_pl(P1, '🎵 A', 's1', 1)], next: null },
      ['/playlists/' + P1 + '?']: detail_pl(P1, '🎵 A', 's1', 1),
      ['/playlists/' + P1 + '/items']: function () {
        fetched += 1;
        return { items: [track_item(T1)], next: null };
      },
    }),
  });
  assert.equal(fetched, 1);
  assert.equal(result.plan.playlists[0].items[0].kind, 'track');
  fs.rmSync(root, { recursive: true, force: true });
});

test('429 中斷後 checkpoint 恢復只補未完成歌單', async function () {
  const root = tmp_root();
  const paths = managed_playlist_paths(root);
  const first = await run_managed_playlist_readback({
    paths: paths,
    baseline: empty_baseline(USER),
    rules: empty_rules(USER),
    manifest: EMPTY_MANIFEST,
    get_json: mock_get({
      '/me': { id: USER },
      '/me/playlists': {
        items: [list_pl(P1, '🎵 A', 's1', 1), list_pl(P2, '🎵 B', 't1', 1)],
        next: null,
      },
      ['/playlists/' + P1 + '?']: detail_pl(P1, '🎵 A', 's1', 1),
      ['/playlists/' + P1 + '/items']: { items: [track_item(T1)], next: null },
      ['/playlists/' + P2]: new SpotifyRequestError('limited', 429, {}, 30),
    }),
  });
  assert.equal(first.read_cost.errors[0].http_status, 429);
  assert.equal(first.plan.apply_supported, false);
  let fetched = [];
  const second = await run_managed_playlist_readback({
    paths: paths,
    baseline: empty_baseline(USER),
    rules: empty_rules(USER),
    manifest: EMPTY_MANIFEST,
    resume: true,
    get_json: mock_get({
      '/me': { id: USER },
      '/me/playlists': {
        items: [list_pl(P1, '🎵 A', 's1', 1), list_pl(P2, '🎵 B', 't1', 1)],
        next: null,
      },
      ['/playlists/' + P2 + '?']: detail_pl(P2, '🎵 B', 't1', 1),
      ['/playlists/' + P2 + '/items']: function () {
        fetched.push(P2);
        return { items: [track_item(T2)], next: null };
      },
      ['/playlists/' + P1 + '/items']: function () {
        fetched.push(P1);
        return { items: [track_item(T1)], next: null };
      },
    }),
  });
  assert.equal(fetched.includes(P1), false);
  assert.equal(fetched.includes(P2), true);
  assert.equal(second.read_cost.playlists_reused_checkpoint, 1);
  assert.equal(second.plan.apply_supported, true);
  const denied = apply_managed_playlist_plan({
    paths: paths,
    plan: first.plan,
    confirm: MANAGED_PLAYLIST_APPLY_TOKEN,
    template_spotify_ids: new Set(),
  });
  assert.equal(denied.ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('首次基準 apply 鎖定現況名稱，並把分類缺席列為人工移除', function () {
  const root = tmp_root();
  const paths = managed_playlist_paths(root);
  const inferred = inferred_catalog_membership(normalize_playlist_items([track_item(T2)]), [T1, T2]);
  assert.deepEqual(inferred.catalog_only, [T1]);
  const plan = build_readback_plan({
    account_id: USER,
    official_item_baseline: false,
    catalog_comparison_available: true,
    baseline_fingerprint: fingerprint_baseline(empty_baseline(USER)),
    diff: {
      playlists: [
        {
          spotify_playlist_id: P1,
          previous_name: '🎵 舊自動',
          current_name: '🎵 華語 / 中國風',
          name_changed: true,
          snapshot_id_after: 's1',
          is_new: false,
          kind: 'template',
          status: 'active',
          can_edit: true,
          items_complete: true,
          items: normalize_playlist_items([track_item(T2)]),
          items_diff: { added: [], removed: [], order_changed: false, repeat_counts: {}, first_capture: true },
          inferred_catalog_only: inferred.catalog_only.map((id) => ({ track_id: id, proven: false })),
          inferred_live_only: [],
        },
      ],
      possible_moves: [],
    },
  });
  const applied = apply_managed_playlist_plan({
    paths: paths,
    plan: plan,
    confirm: MANAGED_PLAYLIST_APPLY_TOKEN,
    rules: empty_rules(USER),
    baseline: empty_baseline(USER),
    operations: empty_operations(),
    template_spotify_ids: new Set([P1]),
  });
  assert.equal(applied.ok, true);
  const rules = load_rules({ paths: paths });
  assert.equal(rules.playlists[P1].retained_name, '🎵 華語 / 中國風');
  assert.equal(rules.playlists[P1].name_locked, true);
  assert.ok(rules.playlists[P1].removed_track_ids.includes(T1));
  const catalog = {
    language_genre_playlists: [
      { playlist_id: 'lg:v2:mandarin:pop', track_ids: [T1, T2], track_count: 2, kind: 'language_genre', label_zh: '華語流行音樂', primary_genre: 'pop', language_bucket: 'mandarin' },
    ],
    emotion_playlists_tentative: [],
  };
  const map = catalog_track_ids_by_spotify_id(catalog, {
    playlists: { 'lg:v2:mandarin:pop': { spotify_playlist_id: P1 } },
  });
  assert.deepEqual(map[P1], [T1, T2]);
  const sync = build_mvp_sync_plan(catalog, { tracks_by_id: { [T1]: {}, [T2]: {} } }, {
    rules: rules,
    manifest: { playlists: { 'lg:v2:mandarin:pop': { spotify_playlist_id: P1 } } },
  });
  assert.equal(sync.playlists[0].uris.some((u) => u.indexOf(T1) >= 0), false);
  assert.equal(sync.playlists[0].spotify_name, '🎵 華語 / 中國風');
  fs.rmSync(root, { recursive: true, force: true });
});

test('全 unavailable 或不完整 plan 不可套用；未確認現況名也不被 metadata 改回', function () {
  const bad = build_readback_plan({
    account_id: USER,
    baseline_fingerprint: fingerprint_baseline(empty_baseline(USER)),
    diff: {
      playlists: [
        {
          spotify_playlist_id: P1,
          current_name: '🎵 A',
          status: 'active',
          can_edit: true,
          items_complete: true,
          items: [{ kind: 'unavailable' }, { kind: 'unavailable' }],
          items_diff: { added: [], removed: [], order_changed: false, repeat_counts: {} },
        },
      ],
      possible_moves: [],
    },
  });
  assert.equal(bad.apply_supported, false);
  assert.equal(validate_plan_for_apply(bad, {}).ok, false);
  const change = apply_human_rules_to_metadata_change({
    spotify_playlist_id: P1,
    current_name: '🎵 華語 / 中國風',
    target_name: '🎵 華語電子',
    update_name: true,
    update_description: false,
    protect_unconfirmed_live: true,
  }, empty_rules(USER));
  assert.equal(change.update_name, false);
  assert.equal(change.skipped_unconfirmed_live_name, true);
});

test('Apply 隔離：歌單層級移除／獨有、404 待確認、重複曲目、來源指紋', function () {
  const root = tmp_root();
  const paths = managed_playlist_paths(root);
  const live_fp = LIVE_FP;
  const items_p1 = normalize_playlist_items([track_item(T2, 'Keep'), track_item(T2, 'Keep')]);
  const items_new = normalize_playlist_items([track_item(T3, 'Custom')]);
  const plan = build_readback_plan({
    account_id: USER,
    official_item_baseline: false,
    catalog_comparison_available: true,
    baseline_fingerprint: fingerprint_baseline(empty_baseline(USER)),
    live_list_fingerprint: live_fp,
    diff: {
      playlists: [
        {
          spotify_playlist_id: P1,
          previous_name: '🎵 華語電子',
          current_name: '🎵 華語 / 中國風',
          name_changed: true,
          snapshot_id_after: 's1',
          is_new: false,
          kind: 'template',
          status: 'active',
          can_edit: true,
          items_complete: true,
          items: items_p1,
          items_diff: { added: [], removed: [], order_changed: false, repeat_counts: { [T2]: 2 } },
          inferred_catalog_only: [{ track_id: T1, proven: false }],
          inferred_live_only: [{ track_id: T2, proven: false }],
        },
        {
          spotify_playlist_id: P404,
          previous_name: '🎵 鄉村 / 藍調',
          current_name: null,
          status: 'deleted_pending',
          capability_reason: 'http_404',
          can_edit: false,
          items_complete: false,
          items: null,
          items_diff: { added: [], removed: [], order_changed: false, repeat_counts: {} },
        },
        {
          spotify_playlist_id: PNEW,
          current_name: '🎵 台語歌手 / 年代',
          is_new: true,
          kind: 'custom',
          status: 'active',
          can_edit: true,
          items_complete: true,
          items: items_new,
          items_diff: { added: items_new, removed: [], order_changed: false, repeat_counts: {} },
        },
      ],
      possible_moves: [],
    },
  });
  const stale = apply_managed_playlist_plan({
    paths: paths,
    plan: plan,
    confirm: MANAGED_PLAYLIST_APPLY_TOKEN,
    rules: empty_rules(USER),
    baseline: empty_baseline(USER),
    operations: empty_operations(),
    current_live_list_fingerprint: 'different-live',
    template_spotify_ids: new Set([P1, P404]),
    manifest: {
      playlists: {
        'lg:v2:other_lang:electronic': { spotify_playlist_id: P1 },
        'lg:v2:other_lang:country_blues': { spotify_playlist_id: P404 },
      },
    },
  });
  assert.equal(stale.ok, false);
  const applied = apply_managed_playlist_plan({
    paths: paths,
    plan: plan,
    confirm: MANAGED_PLAYLIST_APPLY_TOKEN,
    rules: empty_rules(USER),
    baseline: empty_baseline(USER),
    operations: empty_operations(),
    current_live_list_fingerprint: live_fp,
    account_id: USER,
    template_spotify_ids: new Set([P1, P404]),
    manifest: {
      playlists: {
        'lg:v2:other_lang:electronic': { spotify_playlist_id: P1 },
        'lg:v2:other_lang:country_blues': { spotify_playlist_id: P404 },
      },
    },
  });
  assert.equal(applied.ok, true);
  const rules = load_rules({ paths: paths });
  const baseline = load_baseline({ paths: paths });
  assert.equal(rules.playlists[P1].removed_track_ids.includes(T1), true);
  assert.equal(rules.playlists[P1].added_track_ids.includes(T2), true);
  assert.equal(rules.playlists[P1].retained_name, '🎵 華語 / 中國風');
  assert.equal(rules.playlists[P1].name_locked, true);
  assert.equal(rules.playlists[P1].items.filter((i) => i.track_id === T2).length, 2);
  assert.equal(rules.additional_track_index_by_id[T1], undefined);
  assert.equal(is_pending_absence_status(rules.playlists[P404].status), true);
  assert.equal(rules.playlists[P404].absence_proven, false);
  assert.equal(rules.playlists[P404].mapping_retained, true);
  assert.equal(rules.playlists[P404].retained_name, '🎵 鄉村 / 藍調');
  assert.equal(rules.playlists[P404].mvp_playlist_id, 'lg:v2:other_lang:country_blues');
  assert.equal(rules.playlists[P404].items, null);
  assert.equal(baseline.playlists[P404].absence_proven, false);
  assert.equal(rules.playlists[PNEW].kind, 'custom');
  assert.ok(rules.additional_track_index_by_id[T3]);
  const other_ids = Object.keys(rules.playlists).filter((id) => id !== P1);
  assert.equal(other_ids.some((id) => (rules.playlists[id].removed_track_ids || []).includes(T1)), false);
  const catalog = {
    language_genre_playlists: [
      {
        playlist_id: 'lg:v2:other_lang:electronic',
        kind: 'language_genre',
        primary_genre: 'electronic',
        language_bucket: 'other_lang',
        label_zh: '電子音樂／其他',
        track_ids: [T1, T2],
        track_count: 2,
      },
      {
        playlist_id: 'lg:v2:other_lang:country_blues',
        kind: 'language_genre',
        primary_genre: 'country_blues',
        language_bucket: 'other_lang',
        label_zh: '鄉村／藍調',
        track_ids: [T1],
        track_count: 1,
      },
    ],
    emotion_playlists_tentative: [],
  };
  const manifest = {
    playlists: {
      'lg:v2:other_lang:electronic': { spotify_playlist_id: P1, spotify_name: '🎵 華語電子' },
      'lg:v2:other_lang:country_blues': { spotify_playlist_id: P404, spotify_name: '🎵 鄉村 / 藍調' },
    },
  };
  const sync = build_mvp_sync_plan(catalog, { tracks_by_id: { [T1]: {}, [T2]: {} } }, { rules: rules, manifest: manifest });
  const electronic = sync.playlists.find((p) => p.mvp_playlist_id === 'lg:v2:other_lang:electronic');
  const country = sync.playlists.find((p) => p.mvp_playlist_id === 'lg:v2:other_lang:country_blues');
  assert.equal(electronic.spotify_name, '🎵 華語 / 中國風');
  assert.equal(electronic.uris.some((u) => u.indexOf(T1) >= 0), false);
  assert.equal(electronic.uris.some((u) => u.indexOf(T2) >= 0), true);
  assert.equal(country.skip_spotify_writes, true);
  assert.equal(country.uris.length, 0);
  assert.equal(sync.playlists.some((p) => p.mvp_playlist_id === 'custom:' + PNEW), false);
  const rebuilt = build_mvp_playlist_catalog(
    { tracks_by_id: { [T1]: { display: { name: 'Gone' }, tags: [{ dimension: 'language', value: '其他' }], genre_profile: { primary_genre: 'electronic' } }, [T2]: { display: { name: 'Keep' }, tags: [{ dimension: 'language', value: '其他' }], genre_profile: { primary_genre: 'electronic' } } } },
    { human_removed_by_mvp: human_removed_ids_by_mvp_id({ paths: paths, manifest: manifest }) }
  );
  const rebuilt_el = rebuilt.language_genre_playlists.find((p) => p.playlist_id === 'lg:v2:other_lang:electronic');
  if (rebuilt_el) {
    assert.equal(rebuilt_el.track_ids.includes(T1), false);
    assert.equal(rebuilt_el.track_ids.includes(T2), true);
  }
  const meta = apply_human_rules_to_metadata_change({
    spotify_playlist_id: P404,
    current_name: '🎵 鄉村 / 藍調',
    target_name: '🎵 自動鄉村',
    update_name: true,
    update_description: true,
  }, rules);
  assert.equal(meta.update_name, false);
  assert.equal(meta.skipped_pending_status, true);
  const renamed = apply_human_rules_to_metadata_change({
    spotify_playlist_id: P1,
    current_name: '🎵 華語 / 中國風',
    target_name: '🎵 華語電子',
    update_name: true,
    update_description: false,
  }, rules);
  assert.equal(renamed.update_name, false);
  assert_isolated_apply_did_not_touch_official(root, paths);
  fs.rmSync(root, { recursive: true, force: true });
});

test('真實 plan 隔離套用：22 筆移除僅所屬歌單、17 筆獨有保留、404 不搬家', function () {
  const root = tmp_root();
  const paths = managed_playlist_paths(root);
  const hash = '2f5a7276682c85e186e6a86749224f32b9952dd9cc20abc2686b02e0f65f8633';
  const stored = JSON.parse(
    fs.readFileSync(path.join('backup/classification/managed-playlists-readback/plans', hash + '.json'), 'utf8')
  );
  assert.equal(stored.plan_hash, hash);
  const official_rules_hash = file_sha256_or_null(OFFICIAL_RULES);
  const official_baseline_hash = file_sha256_or_null(OFFICIAL_BASELINE);
  const plan = Object.assign({}, stored, { applied: false });
  delete plan.applied_at;
  assert.equal(validate_plan_for_apply(plan, {
    expected_plan_hash: hash,
    account_id: plan.account_id,
    current_baseline_fingerprint: plan.baseline_fingerprint,
    current_live_list_fingerprint: plan.live_list_fingerprint,
  }).ok, true);
  const applied = apply_managed_playlist_plan({
    paths: paths,
    plan: plan,
    confirm: MANAGED_PLAYLIST_APPLY_TOKEN,
    account_id: plan.account_id,
    current_live_list_fingerprint: plan.live_list_fingerprint,
    rules: empty_rules(plan.account_id),
    baseline: empty_baseline(),
    operations: empty_operations(),
  });
  assert.equal(applied.ok, true);
  const rules = load_rules({ paths: paths });
  const baseline = load_baseline({ paths: paths });
  const catalog_only = [];
  const live_only = [];
  for (const row of plan.playlists) {
    for (const x of row.inferred_catalog_only || []) catalog_only.push({ id: row.spotify_playlist_id, track: x.track_id });
    for (const x of row.inferred_live_only || []) live_only.push({ id: row.spotify_playlist_id, track: x.track_id });
  }
  assert.equal(catalog_only.length, 22);
  assert.equal(live_only.length, 17);
  for (const row of catalog_only) {
    assert.equal(rules.playlists[row.id].removed_track_ids.includes(row.track), true);
    const others = Object.keys(rules.playlists).filter((id) => id !== row.id);
    assert.equal(others.some((id) => (rules.playlists[id].removed_track_ids || []).includes(row.track)), false);
  }
  for (const row of live_only) {
    assert.equal(rules.playlists[row.id].added_track_ids.includes(row.track), true);
    assert.equal((rules.playlists[row.id].items || []).some((i) => i.track_id === row.track), true);
  }
  const gone = rules.playlists['51EEJFoje0iIunMVmfMZwd'];
  assert.equal(gone.status, 'deleted_pending');
  assert.equal(gone.absence_proven, false);
  assert.equal(gone.retained_name, '🎵 鄉村 / 藍調');
  assert.equal(gone.mvp_playlist_id, 'lg:v2:other_lang:country_blues');
  assert.equal(gone.items, null);
  assert.equal(baseline.playlists['51EEJFoje0iIunMVmfMZwd'].absence_proven, false);
  assert.equal(rules.playlists['09dV2dhlB753jtj5JZs2C1'].items.length > 0, true);
  assert.equal(rules.playlists['29Q5zSUuVdhi6T9ZA2A9Iz'].items.length > 0, true);
  assert.equal(rules.playlists['55HcM9U4kqFH9Kw3SAakGD'].kind, 'custom');
  assert.equal(rules.playlists['1EOsvMkxIgeJXB9RoK7GLA'].retained_name, '🎵 華語 / 中國風');
  assert.equal(rules.playlists['1EOsvMkxIgeJXB9RoK7GLA'].name_locked, true);
  assert_isolated_apply_did_not_touch_official(root, paths);
  assert.equal(file_sha256_or_null(OFFICIAL_RULES), official_rules_hash);
  assert.equal(file_sha256_or_null(OFFICIAL_BASELINE), official_baseline_hash);
  assert.equal(
    validate_plan_for_apply(plan, {
      current_baseline_fingerprint: plan.baseline_fingerprint,
      current_live_list_fingerprint: 'changed-after-weekend',
    }).ok,
    false
  );
  const stored_after = JSON.parse(
    fs.readFileSync(path.join('backup/classification/managed-playlists-readback/plans', hash + '.json'), 'utf8')
  );
  assert.equal(stored_after.applied, stored.applied);
  fs.rmSync(root, { recursive: true, force: true });
});
