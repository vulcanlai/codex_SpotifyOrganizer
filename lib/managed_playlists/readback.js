/**
 * 唯讀讀回：以 metadata／名稱／snapshot_id 判斷變更，僅完整抓新建或版本變動歌單。
 * 不寫正式規則；不呼叫 Track API；不讀寫非 🎵 歌單曲目。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SpotifyRequestError } from '../spotify_api.js';
import { MANAGED_PLAYLIST_PREFIX } from './constants.js';
import { fingerprint_baseline, fingerprint_live_list, build_readback_plan } from './plan.js';
import { first_baseline_candidates, diff_managed_playlists } from './diff.js';
import { normalize_playlist_items } from './items.js';
import { is_managed_playlist_name, is_spotify_id } from './identity.js';
import {
  ensure_readback_dirs,
  load_baseline,
  load_checkpoint,
  load_rules,
  resolve_paths,
  save_readback_json,
} from './stores.js';
import { sha256_json } from './fingerprint.js';
import { render_readback_report } from './report.js';
import { load_sync_manifest } from '../classification/mvp_playlist_sync_manifest.js';

export function seed_baseline_from_manifest(manifest) {
  const playlists = {};
  const rows = (manifest && manifest.playlists) || {};
  const keys = Object.keys(rows);
  for (let i = 0; i < keys.length; i += 1) {
    const row = rows[keys[i]];
    if (!row || !row.spotify_playlist_id) {
      continue;
    }
    playlists[row.spotify_playlist_id] = {
      name: row.spotify_name || row.catalog_display_name || null,
      snapshot_id: null,
      items: null,
      items_complete: false,
      kind: 'template',
      mvp_playlist_id: keys[i],
    };
  }
  return { playlists: playlists };
}

const LIST_FIELDS = 'items(id,name,snapshot_id,collaborative,owner(id),tracks(total)),next,total';
const DETAIL_FIELDS = 'id,name,snapshot_id,collaborative,public,owner(id),tracks(total)';

export function normalize_list_playlist(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  return {
    id: raw.id,
    name: raw.name,
    snapshot_id: raw.snapshot_id || null,
    collaborative: raw.collaborative === true,
    owner_id: raw.owner && raw.owner.id ? raw.owner.id : null,
    tracks_total: raw.tracks && typeof raw.tracks.total === 'number' ? raw.tracks.total : null,
  };
}

export function pack_snapshot_id(pack) {
  if (!pack) {
    return null;
  }
  if (pack.meta && pack.meta.snapshot_id) {
    return pack.meta.snapshot_id;
  }
  return pack.snapshot_id || null;
}

/**
 * 全 unavailable 的舊快取不能當完整曲目；無 snapshot 也不得用曲目數相同推定未變。
 */
export function pack_items_usable(pack) {
  if (!pack || pack.items_complete !== true || pack.changed_during_read === true) {
    return false;
  }
  if (!Array.isArray(pack.items)) {
    return false;
  }
  let playable = 0;
  let unavailable = 0;
  for (let i = 0; i < pack.items.length; i += 1) {
    const kind = pack.items[i] && pack.items[i].kind;
    if (kind === 'unavailable') {
      unavailable += 1;
    } else if (kind === 'track' || kind === 'episode' || kind === 'local') {
      playable += 1;
    }
  }
  if (unavailable > 0 && playable === 0) {
    return false;
  }
  return true;
}

export function checkpoint_pack_matches_live(pack, live) {
  if (!pack_items_usable(pack) || !live) {
    return false;
  }
  const snap = pack_snapshot_id(pack);
  if (!snap || !live.snapshot_id) {
    return false;
  }
  return snap === live.snapshot_id;
}

/**
 * 增量：新建或 snapshot／名稱需完整項目時才抓曲目。
 * 名稱變更即使 snapshot 相同也要記錄；但名稱-only 可不重抓曲目。
 * 無 snapshot_id 時必須重抓，不得用 tracks.total 推定內容相同。
 */
export function should_fetch_items(live, baseline_row) {
  if (!live || !is_managed_playlist_name(live.name)) {
    return false;
  }
  if (!live.snapshot_id) {
    return true;
  }
  if (!baseline_row) {
    return true;
  }
  if (!pack_items_usable(baseline_row)) {
    return true;
  }
  if (baseline_row.snapshot_id && live.snapshot_id && baseline_row.snapshot_id !== live.snapshot_id) {
    return true;
  }
  if (!baseline_row.snapshot_id) {
    return true;
  }
  return false;
}

/**
 * @param {object} deps 可注入 mock API
 */
export async function run_managed_playlist_readback(deps) {
  const d = deps || {};
  const paths = resolve_paths(d);
  ensure_readback_dirs(paths);

  const get_json = d.get_json;
  if (typeof get_json !== 'function') {
    throw new Error('readback 需要 get_json');
  }

  const checkpoint = d.resume && load_checkpoint({ paths: paths });
  const cost = {
    playlist_list_pages: 0,
    playlist_detail_calls: 0,
    playlist_item_pages: 0,
    playlists_item_fetched: 0,
    playlists_reused_baseline: 0,
    playlists_reused_checkpoint: 0,
    errors: [],
  };

  const me = await call_api(get_json, '/me', cost, 'playlist_detail_calls');
  const account_id = me && me.id ? me.id : null;
  if (!account_id) {
    throw new Error('無法取得目前帳號');
  }
  process.stderr.write('已取得帳號，開始列舉歌單 metadata…\n');

  const listed = await fetch_me_playlists(get_json, cost);
  process.stderr.write('歌單清單 ' + listed.length + ' 份（含非🎵）；接著只完整讀取需更新的🎵歌單。\n');
  save_readback_json(paths.cache_list, {
    account_id: account_id,
    captured_at: new Date().toISOString(),
    playlists: listed,
  });

  const baseline = d.baseline || load_baseline({ paths: paths });
  const rules = d.rules || load_rules({ paths: paths });
  const live_items_by_id = {};
  const missing_lookups = {};

  if (checkpoint && checkpoint.live_items_by_id) {
    Object.assign(live_items_by_id, checkpoint.live_items_by_id);
  }

  for (let i = 0; i < listed.length; i += 1) {
    const live = listed[i];
    if (!is_spotify_id(live.id)) {
      continue;
    }
    if (!is_managed_playlist_name(live.name) && !baseline.playlists[live.id]) {
      continue;
    }
    const prev = baseline.playlists[live.id];
    if (!should_fetch_items(live, prev)) {
      if (prev && Array.isArray(prev.items) && pack_items_usable(prev)) {
        live_items_by_id[live.id] = {
          items: prev.items,
          items_complete: true,
          snapshot_id: prev.snapshot_id || live.snapshot_id,
          reused_baseline: true,
        };
        cost.playlists_reused_baseline += 1;
      }
      continue;
    }
    const reusable = resolve_reusable_pack(live, live_items_by_id, paths);
    if (reusable) {
      live_items_by_id[live.id] = reusable;
      cost.playlists_reused_checkpoint += 1;
      continue;
    }
    try {
      process.stderr.write('完整讀取：' + (live.name || live.id) + '\n');
      const fetched = await fetch_playlist_items_consistent(get_json, live, cost);
      live_items_by_id[live.id] = fetched;
      listed[i] = { ...live, ...fetched.meta };
      save_readback_json(path.join(paths.cache_items_dir, live.id + '.json'), fetched);
      save_readback_json(paths.checkpoint, {
        account_id: account_id,
        updated_at: new Date().toISOString(),
        last_playlist_id: live.id,
        live_items_by_id: summarize_items_map(live_items_by_id),
      });
    } catch (err) {
      const mapped = map_read_error(err);
      cost.errors.push({ spotify_playlist_id: live.id, ...mapped });
      live.http_status = mapped.http_status;
      if (mapped.stop_all) {
        break;
      }
    }
  }

  const has_baseline = Object.keys(baseline.playlists || {}).length > 0;
  const compare_base = has_baseline
    ? baseline
    : seed_baseline_from_manifest(d.manifest || load_sync_manifest(d.manifest_path));
  const stopped_all = cost.errors.some(function (row) {
    return row.stop_all === true;
  });
  const prev_ids = stopped_all ? [] : Object.keys(compare_base.playlists || {});
  for (let p = 0; p < prev_ids.length; p += 1) {
    const id = prev_ids[p];
    if (listed.some(function (row) {
      return row.id === id;
    })) {
      continue;
    }
    try {
      const detail = await call_api(
        get_json,
        '/playlists/' + encodeURIComponent(id) + '?fields=' + DETAIL_FIELDS,
        cost,
        'playlist_detail_calls'
      );
      missing_lookups[id] = {
        direct_ok: true,
        name: detail.name,
        owner_id: detail.owner && detail.owner.id,
        collaborative: detail.collaborative === true,
      };
    } catch (err) {
      missing_lookups[id] = map_read_error(err);
    }
  }

  const excluded = collect_excluded_ids(d.excluded_track_ids, rules);
  const official_item_baseline = official_baseline_has_items(baseline);
  const diff_opts = {
    me_id: account_id,
    excluded_track_ids: excluded,
    missing_lookups: missing_lookups,
    catalog_track_ids_by_spotify_id: d.catalog_track_ids_by_spotify_id || {},
    item_history_proven: official_item_baseline,
  };
  const diff = Object.keys(compare_base.playlists || {}).length
    ? diff_managed_playlists(compare_base, listed, live_items_by_id, diff_opts)
    : first_baseline_candidates(listed, live_items_by_id, diff_opts);

  const plan = build_readback_plan({
    account_id: account_id,
    diff: diff,
    baseline_fingerprint: fingerprint_baseline(baseline),
    live_list_fingerprint: fingerprint_live_list(listed),
    read_cost: cost,
    created_at: new Date().toISOString(),
    official_item_baseline: official_item_baseline,
    catalog_comparison_available: !!(
      d.catalog_track_ids_by_spotify_id && Object.keys(d.catalog_track_ids_by_spotify_id).length
    ),
  });

  save_readback_json(path.join(paths.plans_dir, plan.plan_hash + '.json'), plan);
  save_readback_json(paths.latest_plan, plan);
  const report_md = render_readback_report(plan);
  const report_path = path.join(paths.reports_dir, plan.plan_hash + '.md');
  fs.writeFileSync(report_path, report_md, 'utf8');

  return {
    ok: true,
    dry_run: true,
    applied: false,
    account_id: account_id,
    plan: plan,
    plan_hash: plan.plan_hash,
    plan_path: path.join(paths.plans_dir, plan.plan_hash + '.json'),
    report_path: report_path,
    read_cost: cost,
    prefix: MANAGED_PLAYLIST_PREFIX,
    notes_zh: '真實讀回僅產生預覽；尚未確認保存。',
  };
}

async function fetch_me_playlists(get_json, cost) {
  const items = [];
  let url = '/me/playlists?limit=50&fields=' + encodeURIComponent(LIST_FIELDS);
  while (url) {
    const page = await call_api(get_json, url, cost, 'playlist_list_pages');
    const rows = Array.isArray(page.items) ? page.items : [];
    for (let i = 0; i < rows.length; i += 1) {
      const n = normalize_list_playlist(rows[i]);
      if (n && is_spotify_id(n.id)) {
        items.push(n);
      }
    }
    url = page.next || null;
  }
  return items;
}

async function fetch_playlist_items_consistent(get_json, live, cost) {
  const before = await call_api(
    get_json,
    '/playlists/' + encodeURIComponent(live.id) + '?fields=' + DETAIL_FIELDS,
    cost,
    'playlist_detail_calls'
  );
  const raw_items = [];
  let url =
    '/playlists/' +
    encodeURIComponent(live.id) +
    '/items?limit=50&additional_types=track%2Cepisode';
  while (url) {
    const page = await call_api(get_json, url, cost, 'playlist_item_pages');
    const rows = Array.isArray(page.items) ? page.items : [];
    for (let i = 0; i < rows.length; i += 1) {
      raw_items.push(rows[i]);
    }
    url = page.next || null;
  }
  const after = await call_api(
    get_json,
    '/playlists/' + encodeURIComponent(live.id) + '?fields=' + DETAIL_FIELDS,
    cost,
    'playlist_detail_calls'
  );
  const changed = !!(before.snapshot_id && after.snapshot_id && before.snapshot_id !== after.snapshot_id);
  cost.playlists_item_fetched += 1;
  return {
    meta: {
      name: after.name || before.name || live.name,
      snapshot_id: after.snapshot_id || before.snapshot_id || live.snapshot_id,
      collaborative: after.collaborative === true,
      owner_id: after.owner && after.owner.id ? after.owner.id : live.owner_id,
      tracks_total: after.tracks && after.tracks.total,
    },
    items: normalize_playlist_items(raw_items),
    items_complete: !changed,
    changed_during_read: changed,
  };
}

async function call_api(get_json, url, cost, counter) {
  cost[counter] += 1;
  return get_json(url);
}

function map_read_error(err) {
  const status = err instanceof SpotifyRequestError ? err.status : err && err.status;
  if (status === 429) {
    return { http_status: 429, stop_all: true, kind: 'rate_limited', retry_after_sec: err.retry_after_sec || null };
  }
  if (status === 401) {
    return { http_status: 401, stop_all: true, kind: 'unauthorized' };
  }
  if (status === 403) {
    return { http_status: 403, stop_all: false, kind: 'forbidden' };
  }
  if (status === 404) {
    return { http_status: 404, stop_all: false, kind: 'not_found' };
  }
  if (status === 0 || (err && err.name === 'TypeError')) {
    return { http_status: 0, stop_all: false, kind: 'network' };
  }
  return { http_status: status || 0, stop_all: false, kind: 'other', message: err && err.message };
}

function resolve_reusable_pack(live, memory_map, paths) {
  const mem = memory_map && memory_map[live.id];
  if (mem && !pack_snapshot_id(mem)) {
    const cached = load_cached_pack(paths, live.id);
    if (cached) {
      mem.snapshot_id = pack_snapshot_id(cached);
      mem.meta = mem.meta || cached.meta;
    }
  }
  if (checkpoint_pack_matches_live(mem, live)) {
    return mem;
  }
  const cached = load_cached_pack(paths, live.id);
  if (checkpoint_pack_matches_live(cached, live)) {
    return cached;
  }
  return null;
}

function load_cached_pack(paths, id) {
  if (!paths || !paths.cache_items_dir || !id) {
    return null;
  }
  const file_path = path.join(paths.cache_items_dir, id + '.json');
  if (!fs.existsSync(file_path)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file_path, 'utf8'));
  } catch {
    return null;
  }
}

function official_baseline_has_items(baseline) {
  const rows = (baseline && baseline.playlists) || {};
  const ids = Object.keys(rows);
  for (let i = 0; i < ids.length; i += 1) {
    if (pack_items_usable(rows[ids[i]])) {
      return true;
    }
  }
  return false;
}

function summarize_items_map(map) {
  const out = {};
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i += 1) {
    const row = map[keys[i]];
    out[keys[i]] = {
      items: row.items,
      items_complete: row.items_complete,
      changed_during_read: row.changed_during_read,
      snapshot_id: pack_snapshot_id(row),
    };
  }
  return out;
}

function collect_excluded_ids(explicit, rules) {
  const ids = [];
  if (Array.isArray(explicit)) {
    ids.push.apply(ids, explicit);
  }
  if (rules && Array.isArray(rules.excluded_track_ids)) {
    ids.push.apply(ids, rules.excluded_track_ids);
  }
  return ids;
}

export function live_list_cache_fingerprint(listed) {
  return sha256_json(listed);
}

/**
 * Apply 前只抓歌單清單 metadata，不重抓曲目。
 */
export async function fetch_live_list_fingerprint(get_json) {
  const cost = {
    playlist_list_pages: 0,
    playlist_detail_calls: 0,
    playlist_item_pages: 0,
    playlists_item_fetched: 0,
    playlists_reused_baseline: 0,
    playlists_reused_checkpoint: 0,
    errors: [],
  };
  const me = await call_api(get_json, '/me', cost, 'playlist_detail_calls');
  const listed = await fetch_me_playlists(get_json, cost);
  return {
    account_id: me && me.id ? me.id : null,
    listed: listed,
    live_list_fingerprint: fingerprint_live_list(listed),
    cost: cost,
  };
}
