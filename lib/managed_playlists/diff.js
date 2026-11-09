/**
 * 本機基準與 Spotify 實況差異。名稱變更不依賴曲目 snapshot。
 */
import { items_fingerprint, name_fingerprint } from './fingerprint.js';
import { classify_playlist_capability, is_managed_playlist_name } from './identity.js';
import { diff_playlist_items, possible_moves_from_diffs } from './items.js';

/**
 * @param {object} baseline
 * @param {object} live_list  /me/playlists 正規化列
 * @param {object} live_items_by_id  已完整讀取的項目
 */
export function diff_managed_playlists(baseline, live_list, live_items_by_id, options) {
  const opts = options || {};
  const me_id = opts.me_id || null;
  const excluded_ids = new Set(opts.excluded_track_ids || []);
  const baseline_playlists = (baseline && baseline.playlists) || {};
  const listed = new Map();
  for (let i = 0; i < (live_list || []).length; i += 1) {
    listed.set(live_list[i].id, live_list[i]);
  }

  const rows = [];
  const seen = new Set();

  for (const [id, live] of listed) {
    const managed_now = is_managed_playlist_name(live.name);
    const was_managed = !!baseline_playlists[id];
    if (!managed_now && !was_managed) {
      continue;
    }
    seen.add(id);
    const prev = baseline_playlists[id] || null;
    const pack = live_items_by_id && live_items_by_id[id] ? live_items_by_id[id] : null;
    const live_items = pack && pack.items ? pack.items : null;
    const capability = classify_playlist_capability({
      listed_in_me: true,
      name: live.name,
      owner_id: live.owner_id,
      me_id: me_id,
      collaborative: live.collaborative,
      http_status: live.http_status,
    });
    rows.push(
      build_row(
        id,
        prev,
        { ...live, ...pack, ...(pack && pack.meta) },
        live_items,
        capability,
        excluded_ids,
        !prev,
        opts
      )
    );
  }

  const prev_ids = Object.keys(baseline_playlists);
  for (let p = 0; p < prev_ids.length; p += 1) {
    const id = prev_ids[p];
    if (seen.has(id)) {
      continue;
    }
    const missing = (opts.missing_lookups && opts.missing_lookups[id]) || {};
    const capability = classify_playlist_capability({
      listed_in_me: false,
      direct_ok: missing.direct_ok === true,
      http_status: missing.http_status,
      name: missing.name,
      owner_id: missing.owner_id,
      me_id: me_id,
      collaborative: missing.collaborative,
    });
    const lookup_done = !!(opts.missing_lookups && Object.prototype.hasOwnProperty.call(opts.missing_lookups, id));
    const lookup_blocked = missing.stop_all === true || missing.kind === 'network' || missing.kind === 'rate_limited';
    rows.push({
      spotify_playlist_id: id,
      previous_name: baseline_playlists[id].name || null,
      current_name: missing.name || null,
      name_changed: false,
      snapshot_changed: false,
      is_new: false,
      skipped_unchanged: false,
      status: capability.status,
      can_edit: capability.can_edit,
      capability_reason: capability.reason,
      items_complete: false,
      items_diff: { added: [], removed: [], order_changed: false, repeat_counts: {} },
      incomplete: !lookup_done || lookup_blocked,
      conflicts: [],
    });
  }

  return {
    playlists: rows,
    possible_moves: possible_moves_from_diffs(rows),
    unchanged_count: rows.filter(function (r) {
      return r.skipped_unchanged;
    }).length,
    changed_count: rows.filter(function (r) {
      return !r.skipped_unchanged;
    }).length,
  };
}

function build_row(id, prev, live, live_items, capability, excluded_ids, is_new, opts) {
  const name_changed = !!(prev && prev.name !== live.name);
  const snapshot_changed = !!(
    prev &&
    live.snapshot_id &&
    prev.snapshot_id &&
    prev.snapshot_id !== live.snapshot_id
  );
  const name_only = name_changed && !snapshot_changed;
  const items_ready = Array.isArray(live_items);
  const have_prev_items = !!(prev && Array.isArray(prev.items));
  const prev_items = have_prev_items ? prev.items : [];
  const items_diff = !items_ready
    ? { added: [], removed: [], order_changed: false, repeat_counts: {} }
    : have_prev_items || is_new
      ? diff_playlist_items(prev_items, live_items)
      : { added: [], removed: [], order_changed: false, repeat_counts: {}, first_capture: true };
  const unchanged =
    !is_new &&
    !name_changed &&
    !snapshot_changed &&
    capability.status === 'active' &&
    (!items_ready ||
      (items_diff.added.length === 0 &&
        items_diff.removed.length === 0 &&
        !items_diff.order_changed));

  const conflicts = [];
  if (items_ready) {
    for (let i = 0; i < live_items.length; i += 1) {
      const tid = live_items[i].track_id;
      if (tid && excluded_ids.has(tid)) {
        conflicts.push({
          type: 'excluded_track_readded',
          spotify_playlist_id: id,
          track_id: tid,
          note_zh: '人工重新加入原排除曲目；不得默默丟棄或自動解除排除。',
        });
      }
    }
  }

  const item_history_proven = !!(opts && opts.item_history_proven && have_prev_items);
  const catalog_ids =
    opts && opts.catalog_track_ids_by_spotify_id ? opts.catalog_track_ids_by_spotify_id[id] : null;
  const inferred = Array.isArray(catalog_ids)
    ? inferred_catalog_membership(live_items, catalog_ids)
    : { catalog_only: [], live_only: [] };
  if (inferred.catalog_only.length || inferred.live_only.length) {
    conflicts.push({
      type: 'inferred_catalog_divergence',
      spotify_playlist_id: id,
      proven: false,
      catalog_only_count: inferred.catalog_only.length,
      live_only_count: inferred.live_only.length,
      note_zh:
        '與自動分類預期不同，僅能推定、不能當成已證明的人工操作。確認保存後才把分類多出的曲目列為該歌單人工移除。',
    });
  }

  return {
    spotify_playlist_id: id,
    previous_name: prev ? prev.name : null,
    current_name: live.name,
    name_changed: name_changed,
    name_only_change: name_only,
    snapshot_id_before: prev ? prev.snapshot_id || null : null,
    snapshot_id_after: live.snapshot_id || null,
    snapshot_changed: snapshot_changed,
    tracks_total: live.tracks_total,
    is_new: is_new,
    kind: is_new ? 'custom' : prev && prev.kind ? prev.kind : 'template',
    skipped_unchanged: unchanged,
    status: capability.status,
    can_edit: capability.can_edit,
    capability_reason: capability.reason,
    collaborative: live.collaborative === true,
    owner_id: live.owner_id || null,
    items_complete: items_ready && live.items_complete !== false,
    changed_during_read: live.changed_during_read === true,
    items_diff: items_diff,
    items: items_ready ? live_items : null,
    name_fingerprint: name_fingerprint(live.name),
    items_fingerprint: items_ready ? items_fingerprint(live_items) : null,
    incomplete: live.changed_during_read === true || !items_ready,
    conflicts: conflicts,
    item_history_proven: item_history_proven,
    inferred_catalog_only: inferred.catalog_only.map(function (track_id) {
      return { track_id: track_id, proven: false };
    }),
    inferred_live_only: inferred.live_only.map(function (track_id) {
      return { track_id: track_id, proven: false };
    }),
  };
}

/**
 * 分類預期 vs Spotify 現況。結果是推定，不是已證明的人工操作。
 */
export function inferred_catalog_membership(live_items, catalog_ids) {
  const live_ids = [];
  const seen = new Set();
  const rows = live_items || [];
  for (let i = 0; i < rows.length; i += 1) {
    const tid = rows[i] && rows[i].track_id;
    if (tid && !seen.has(tid)) {
      seen.add(tid);
      live_ids.push(tid);
    }
  }
  const cat = Array.isArray(catalog_ids) ? catalog_ids : [];
  const live_set = new Set(live_ids);
  const cat_set = new Set(cat);
  return {
    proven: false,
    catalog_only: cat.filter(function (id) {
      return !live_set.has(id);
    }),
    live_only: live_ids.filter(function (id) {
      return !cat_set.has(id);
    }),
  };
}

export function catalog_track_ids_by_spotify_id(catalog, manifest) {
  const out = {};
  const rows = (manifest && manifest.playlists) || {};
  const all = []
    .concat((catalog && catalog.language_genre_playlists) || [])
    .concat((catalog && catalog.emotion_playlists_tentative) || []);
  for (let i = 0; i < all.length; i += 1) {
    const pl = all[i];
    const sid = rows[pl.playlist_id] && rows[pl.playlist_id].spotify_playlist_id;
    if (sid) {
      out[sid] = pl.track_ids || [];
    }
  }
  return out;
}

/**
 * 第一次沒有基準時，全部列為待確認納管，不假裝已同步。
 */
export function first_baseline_candidates(live_list, live_items_by_id, options) {
  return diff_managed_playlists({ playlists: {} }, live_list, live_items_by_id, options);
}
