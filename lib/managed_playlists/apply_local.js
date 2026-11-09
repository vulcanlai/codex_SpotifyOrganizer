/**
 * 使用者明確確認指定 plan 後，原子保存本機人工優先調整。
 * 失敗不留半套；不修改 Spotify。
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../atomic_json.js';
import {
  KIND_CUSTOM,
  KIND_TEMPLATE,
  MANAGED_PLAYLIST_APPLY_TOKEN,
  PLAYLIST_STATUS_ACTIVE,
} from './constants.js';
import { fingerprint_baseline, fingerprint_live_list, validate_plan_for_apply } from './plan.js';
import {
  empty_operations,
  load_baseline,
  load_operations,
  load_plan_by_hash,
  load_rules,
  resolve_paths,
} from './stores.js';
import { is_pending_absence_status, is_spotify_id } from './identity.js';
import { normalize_list_playlist } from './readback.js';
import { invert_manifest_spotify_ids } from './sync_respect.js';
import {
  load_sync_manifest,
  mvp_sync_spotify_playlist_id_set,
} from '../classification/mvp_playlist_sync_manifest.js';

export function apply_managed_playlist_plan(options) {
  const opts = options || {};
  if (opts.confirm !== MANAGED_PLAYLIST_APPLY_TOKEN) {
    return { ok: false, reason_zh: '缺少或錯誤的確認旗標' };
  }
  const paths = resolve_paths(opts);
  const plan = opts.plan || load_plan_by_hash(opts.plan_hash, { paths: paths });
  if (!plan) {
    return { ok: false, reason_zh: '找不到指定 plan' };
  }
  const rules = opts.rules || load_rules({ paths: paths });
  const baseline = opts.baseline || load_baseline({ paths: paths });
  const operations = opts.operations || load_operations({ paths: paths });
  const applied = new Set(
    (operations.entries || [])
      .filter(function (e) {
        return e.kind === 'apply_plan' && e.plan_hash;
      })
      .map(function (e) {
        return e.plan_hash;
      })
  );
  const live_fp =
    opts.current_live_list_fingerprint || live_list_fingerprint_from_cache(paths);
  const check = validate_plan_for_apply(plan, {
    expected_plan_hash: opts.plan_hash || plan.plan_hash,
    account_id: opts.account_id || rules.account_id || baseline.account_id,
    current_baseline_fingerprint: fingerprint_baseline(baseline),
    current_live_list_fingerprint: live_fp,
    applied_hashes: applied,
  });
  if (!check.ok) {
    return check;
  }
  if (plan.live_list_fingerprint && !live_fp) {
    return { ok: false, reason_zh: '缺少來源清單指紋，拒絕套用；請重新讀回或提供現況清單版本' };
  }

  const next_rules = structuredClone(rules);
  const next_baseline = structuredClone(baseline);
  next_rules.account_id = next_rules.account_id || plan.account_id;
  next_baseline.account_id = next_baseline.account_id || plan.account_id;
  next_rules.additional_tracks_user_id = next_rules.account_id;
  if (!next_rules.additional_track_index_by_id) {
    next_rules.additional_track_index_by_id = {};
  }
  const undo = { playlists: {}, additional_track_ids: [] };
  const manifest = opts.manifest || load_sync_manifest(opts.manifest_path);
  const template_ids = opts.template_spotify_ids || mvp_sync_spotify_playlist_id_set(manifest);
  const mvp_by_spotify = invert_manifest_spotify_ids(manifest);

  try {
    for (let i = 0; i < plan.playlists.length; i += 1) {
      const row = plan.playlists[i];
      if (row.skipped_unchanged && next_rules.playlists[row.spotify_playlist_id]) {
        continue;
      }
      const prev_rule = next_rules.playlists[row.spotify_playlist_id] || null;
      undo.playlists[row.spotify_playlist_id] = prev_rule;
      const removed_ids = new Set((prev_rule && prev_rule.removed_track_ids) || []);
      const added_ids = new Set((prev_rule && prev_rule.added_track_ids) || []);
      for (let r = 0; r < (row.removed || []).length; r += 1) {
        if (row.removed[r].track_id) {
          removed_ids.add(row.removed[r].track_id);
          added_ids.delete(row.removed[r].track_id);
        }
      }
      const lock_inferred =
        !plan.human_baseline || plan.human_baseline.lock_inferred_catalog_absences_as_removals !== false;
      if (lock_inferred) {
        const inferred = row.inferred_catalog_only || [];
        for (let c = 0; c < inferred.length; c += 1) {
          const cid = inferred[c] && (inferred[c].track_id || inferred[c]);
          if (cid) {
            removed_ids.add(cid);
            added_ids.delete(cid);
          }
        }
      }
      const live_keep = row.inferred_live_only || [];
      for (let k = 0; k < live_keep.length; k += 1) {
        const kid = live_keep[k] && (live_keep[k].track_id || live_keep[k]);
        if (kid) {
          added_ids.add(kid);
        }
      }
      for (let a = 0; a < (row.added || []).length; a += 1) {
        const item = row.added[a];
        if (item.track_id) {
          added_ids.add(item.track_id);
          // 人工加回不自動從排除清單消失；衝突另列。
        }
        merge_additional_track(next_rules, plan.account_id, item, undo.additional_track_ids);
      }
      const pending = is_pending_absence_status(row.status);
      const kept_items = Array.isArray(row.items)
        ? row.items
        : prev_rule && Array.isArray(prev_rule.items)
          ? prev_rule.items
          : null;
      next_rules.playlists[row.spotify_playlist_id] = {
        spotify_playlist_id: row.spotify_playlist_id,
        kind: row.is_new
          ? (template_ids.has(row.spotify_playlist_id) ? KIND_TEMPLATE : KIND_CUSTOM)
          : (prev_rule && prev_rule.kind) || row.kind || KIND_TEMPLATE,
        mvp_playlist_id:
          (prev_rule && prev_rule.mvp_playlist_id) || mvp_by_spotify[row.spotify_playlist_id] || null,
        retained_name:
          row.current_name || row.previous_name || (prev_rule && prev_rule.retained_name) || null,
        name_locked:
          row.name_changed ||
          !!(prev_rule && prev_rule.name_locked) ||
          !!(plan.human_baseline && plan.human_baseline.lock_live_as_human_priority_on_apply),
        status: row.status || PLAYLIST_STATUS_ACTIVE,
        can_edit: row.can_edit === true,
        collaborative_readonly: row.status === 'readonly_foreign',
        owner_id: null,
        removed_track_ids: [...removed_ids],
        added_track_ids: [...added_ids],
        items: pending ? kept_items : kept_items || [],
        source_snapshot_id: row.snapshot_id_after || null,
        absence_proven: false,
        mapping_retained: true,
      };
      if (pending) {
        next_baseline.playlists[row.spotify_playlist_id] = {
          name: row.current_name || row.previous_name || (prev_rule && prev_rule.retained_name) || null,
          snapshot_id: row.snapshot_id_after || (prev_rule && prev_rule.source_snapshot_id) || null,
          items: kept_items,
          items_complete: Array.isArray(row.items) && row.items_complete === true,
          kind: next_rules.playlists[row.spotify_playlist_id].kind,
          status: row.status,
          absence_proven: false,
        };
      } else if (row.items && row.items_complete) {
        next_baseline.playlists[row.spotify_playlist_id] = {
          name: row.current_name,
          snapshot_id: row.snapshot_id_after,
          items: row.items,
          items_complete: true,
          kind: next_rules.playlists[row.spotify_playlist_id].kind,
        };
      } else if (row.name_changed && next_baseline.playlists[row.spotify_playlist_id]) {
        next_baseline.playlists[row.spotify_playlist_id].name = row.current_name;
      } else if (row.is_new && row.items) {
        next_baseline.playlists[row.spotify_playlist_id] = {
          name: row.current_name,
          snapshot_id: row.snapshot_id_after,
          items: row.items,
          items_complete: row.items_complete === true,
          kind: KIND_CUSTOM,
        };
      }
    }
    next_rules.exclusion_conflicts = plan.conflicts || [];
    next_rules.operation_generation = (next_rules.operation_generation || 0) + 1;
    next_rules.updated_at = new Date().toISOString();
    next_baseline.captured_at = next_rules.updated_at;

    const next_ops = operations && operations.entries ? operations : empty_operations();
    next_ops.entries.push({
      kind: 'apply_plan',
      plan_hash: plan.plan_hash,
      account_id: plan.account_id,
      applied_at: next_rules.updated_at,
      undo: undo,
    });

    const prev_rules = read_bytes(paths.rules);
    const prev_baseline = read_bytes(paths.baseline);
    const prev_ops = read_bytes(paths.operations);
    try {
      write_json_atomic(paths.rules, next_rules);
      write_json_atomic(paths.baseline, next_baseline);
      write_json_atomic(paths.operations, next_ops);
      mark_plan_applied(paths, plan);
    } catch (write_err) {
      restore_bytes(paths.rules, prev_rules);
      restore_bytes(paths.baseline, prev_baseline);
      restore_bytes(paths.operations, prev_ops);
      throw write_err;
    }

    return {
      ok: true,
      applied: true,
      plan_hash: plan.plan_hash,
      rules_path: paths.rules,
      baseline_path: paths.baseline,
      additional_track_count: Object.keys(next_rules.additional_track_index_by_id).length,
      note_zh: '已保存本機人工優先調整；未修改 Spotify。請執行 classify:build 讓新曲目出現在管理介面。',
    };
  } catch (err) {
    return {
      ok: false,
      reason_zh: '保存失敗，未承諾半套狀態：' + (err && err.message ? err.message : String(err)),
    };
  }
}

function live_list_fingerprint_from_cache(paths) {
  if (!paths || !paths.cache_list || !fs.existsSync(paths.cache_list)) {
    return null;
  }
  try {
    const cache = JSON.parse(fs.readFileSync(paths.cache_list, 'utf8'));
    const listed = (cache.playlists || [])
      .map(function (row) {
        return normalize_list_playlist(row) || row;
      })
      .filter(Boolean);
    return fingerprint_live_list(listed);
  } catch {
    return null;
  }
}

function read_bytes(file_path) {
  return fs.existsSync(file_path) ? fs.readFileSync(file_path) : null;
}

function restore_bytes(file_path, bytes) {
  if (bytes === null) {
    if (fs.existsSync(file_path)) {
      fs.unlinkSync(file_path);
    }
    return;
  }
  fs.writeFileSync(file_path, bytes);
}

function merge_additional_track(rules, user_id, item, undo_ids) {
  if (!item || !is_spotify_id(item.track_id) || item.kind !== 'track') {
    return;
  }
  if (rules.additional_track_index_by_id[item.track_id]) {
    return;
  }
  rules.additional_track_index_by_id[item.track_id] = {
    spotify_id: item.track_id,
    uri: item.uri || 'spotify:track:' + item.track_id,
    name: item.name || item.track_id,
    artists: item.artists && item.artists.length ? item.artists : ['（讀回尚未補 Metadata）'],
    source: 'managed_playlist_readback',
    metadata_complete: false,
  };
  undo_ids.push(item.track_id);
  rules.additional_tracks_user_id = user_id;
}

function mark_plan_applied(paths, plan) {
  const marked = { ...plan, applied: true, applied_at: new Date().toISOString() };
  write_json_atomic(path.join(paths.plans_dir, plan.plan_hash + '.json'), marked);
  if (fs.existsSync(paths.latest_plan)) {
    write_json_atomic(paths.latest_plan, marked);
  }
}

/**
 * 小範圍復原最近一次 apply（只還原該次 undo）。
 */
export function restore_last_apply(options) {
  const paths = resolve_paths(options);
  const operations = load_operations({ paths: paths });
  const last = operations.entries.filter(function (e) {
    return e.kind === 'apply_plan';
  }).pop();
  if (!last || !last.undo) {
    return { ok: false, reason_zh: '沒有可復原的 apply' };
  }
  const rules = load_rules({ paths: paths });
  const undo = last.undo;
  const ids = Object.keys(undo.playlists || {});
  for (let i = 0; i < ids.length; i += 1) {
    if (undo.playlists[ids[i]]) {
      rules.playlists[ids[i]] = undo.playlists[ids[i]];
    } else {
      delete rules.playlists[ids[i]];
    }
  }
  for (let t = 0; t < (undo.additional_track_ids || []).length; t += 1) {
    delete rules.additional_track_index_by_id[undo.additional_track_ids[t]];
  }
  rules.operation_generation = (rules.operation_generation || 0) + 1;
  write_json_atomic(paths.rules, rules);
  operations.entries.push({
    kind: 'restore_apply',
    plan_hash: last.plan_hash,
    restored_at: new Date().toISOString(),
  });
  write_json_atomic(paths.operations, operations);
  return { ok: true, restored_plan_hash: last.plan_hash };
}
