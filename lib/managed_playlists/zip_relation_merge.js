/**
 * 公司／家裡關係層三方合併。不可用 mtime 或「ZIP 較新」覆蓋。
 * ledger 驗證移除 ≠ 人工規則 ≠ 演算法分類。
 */
import { createHash } from 'node:crypto';
import { relations, validate_library, preview_sync } from '../cleanup/preview.js';
import { sha256_json } from './fingerprint.js';

const relation_key = (r) => JSON.stringify([r.kind, r.container_id ?? null, r.spotify_id, r.position ?? null]);
const identity_key = (r) => JSON.stringify([r.kind, r.container_id ?? null, r.spotify_id]);

export function digest_library(doc) {
  return sha256_json({ user_id: doc && doc.user_id, relations: relations(doc) });
}

/**
 * 只對已知可判定關係自動合併；衝突待選。
 */
export function build_relation_merge_plan(params) {
  const p = params || {};
  if (!p.local || !p.incoming) {
    return { ok: false, allow_apply: false, reason_zh: '缺少本機或來源曲庫' };
  }
  try {
    validate_library(p.local);
    validate_library(p.incoming);
  } catch (err) {
    return { ok: false, allow_apply: false, reason_zh: '曲庫格式未知或不完整：' + err.message };
  }
  if (!p.local.user_id || p.local.user_id !== p.incoming.user_id) {
    return { ok: false, allow_apply: false, reason_zh: '來源帳號不一致' };
  }
  if (p.ledger && (!p.baseline || !p.common_baseline_ok)) {
    try {
      const preview = preview_sync(p.local, p.incoming, p.ledger, { baseline: p.baseline || null });
      if (preview.requires_common_baseline) {
        return {
          ok: false,
          allow_apply: false,
          allow_whole_file: false,
          reason_zh: '有清理 ledger 但無共同基準；維持阻擋整檔覆蓋。',
          preview: preview,
        };
      }
    } catch (err) {
      return { ok: false, allow_apply: false, reason_zh: 'ledger 無法驗證：' + err.message };
    }
  }

  const local_rel = relations(p.local);
  const incoming_rel = relations(p.incoming);
  const baseline_rel = p.baseline ? relations(p.baseline) : [];
  const local_map = new Map(local_rel.map(function (r) {
    return [relation_key(r), r];
  }));
  const incoming_map = new Map(incoming_rel.map(function (r) {
    return [relation_key(r), r];
  }));
  const baseline_map = new Map(baseline_rel.map(function (r) {
    return [relation_key(r), r];
  }));
  const ledger_ids = new Set();
  if (p.ledger && Array.isArray(p.ledger.events)) {
    for (let i = 0; i < p.ledger.events.length; i += 1) {
      const e = p.ledger.events[i];
      ledger_ids.add(identity_key(e));
    }
  }

  const auto_remove = [];
  const auto_add = [];
  const protect_local = [];
  const conflicts = [];

  for (const [k, row] of local_map) {
    if (incoming_map.has(k)) {
      continue;
    }
    if (ledger_ids.has(identity_key(row))) {
      if (p.baseline && !baseline_map.has(k)) {
        conflicts.push({ relation: row, reason_zh: '家裡自共同基準後新增或改動，保護不自動移除' });
      } else {
        auto_remove.push(row);
      }
      continue;
    }
    protect_local.push(row);
  }

  for (const [k, row] of incoming_map) {
    if (local_map.has(k)) {
      continue;
    }
    if (ledger_ids.has(identity_key(row))) {
      conflicts.push({ relation: row, reason_zh: '來源含已驗證刪除關係，停止自動加入以免復活' });
      continue;
    }
    auto_add.push(row);
  }

  const rules_merge = merge_managed_rules(p.local_rules, p.incoming_rules, p.baseline_rules);
  if (rules_merge.conflicts.length) {
    conflicts.push.apply(conflicts, rules_merge.conflicts);
  }

  const body = {
    schema_version: 1,
    account_id: p.local.user_id,
    allow_whole_file: false,
    auto_remove: auto_remove,
    auto_add: auto_add,
    protect_local: protect_local,
    conflicts: conflicts,
    rules_auto: rules_merge.auto,
    source_fingerprints: {
      local: digest_library(p.local),
      incoming: digest_library(p.incoming),
      baseline: p.baseline ? digest_library(p.baseline) : null,
    },
  };
  const plan_hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return {
    ok: conflicts.length === 0,
    allow_apply: conflicts.length === 0,
    allow_whole_file: false,
    plan_hash: plan_hash,
    ...body,
    reason_zh:
      conflicts.length === 0
        ? '關係層可自動合併；仍須明確確認才套用，且不得整檔覆蓋。'
        : '存在待選衝突，不能自動套用。',
  };
}

function merge_managed_rules(local_rules, incoming_rules, baseline_rules) {
  const auto = { playlists: {} };
  const conflicts = [];
  const local_p = (local_rules && local_rules.playlists) || {};
  const incoming_p = (incoming_rules && incoming_rules.playlists) || {};
  const baseline_p = (baseline_rules && baseline_rules.playlists) || {};
  const ids = new Set([...Object.keys(local_p), ...Object.keys(incoming_p)]);
  for (const id of ids) {
    const a = local_p[id];
    const b = incoming_p[id];
    const base = baseline_p[id];
    if (a && !b) {
      auto.playlists[id] = a;
      continue;
    }
    if (b && !a) {
      auto.playlists[id] = b;
      continue;
    }
    if (a && b && JSON.stringify(a) === JSON.stringify(b)) {
      auto.playlists[id] = a;
      continue;
    }
    if (base && a && JSON.stringify(a) === JSON.stringify(base)) {
      auto.playlists[id] = b;
      continue;
    }
    if (base && b && JSON.stringify(b) === JSON.stringify(base)) {
      auto.playlists[id] = a;
      continue;
    }
    if (a && b) {
      conflicts.push({
        spotify_playlist_id: id,
        reason_zh: '兩端自共同基準後各自改動同一歌單規則，待選',
      });
    }
  }
  return { auto: auto, conflicts: conflicts };
}

/**
 * 套用關係層合併到曲庫複本；不碰按讚／專輯除非來源明確列出且非 ledger 衝突。
 */
export function apply_relation_merge_to_library(local, plan) {
  if (!plan || !plan.allow_apply) {
    throw new Error('關係合併 plan 不可套用');
  }
  const next = structuredClone(local);
  const remove_ids = new Set((plan.auto_remove || []).map(identity_key));
  for (const [id, row] of Object.entries(next.track_index_by_spotify_id)) {
    row.appearances = (row.appearances || []).filter(function (a) {
      const r = {
        kind: a.kind,
        container_id: a.kind === 'playlist' ? a.playlist_id : a.kind === 'saved_album' ? a.album_id : null,
        spotify_id: id,
      };
      return !remove_ids.has(identity_key(r));
    });
  }
  next.playlist_track_entries = (next.playlist_track_entries || []).filter(function (x) {
    return !remove_ids.has(identity_key({ kind: 'playlist', container_id: x.playlist_id, spotify_id: x.spotify_id }));
  });
  for (let i = 0; i < (plan.auto_add || []).length; i += 1) {
    const r = plan.auto_add[i];
    if (r.kind !== 'playlist') {
      continue;
    }
    next.playlist_track_entries.push({
      spotify_id: r.spotify_id,
      playlist_id: r.container_id,
      position: r.position,
    });
    const row = next.track_index_by_spotify_id[r.spotify_id] || {
      spotify_id: r.spotify_id,
      appearances: [],
    };
    row.appearances = row.appearances || [];
    row.appearances.push({ kind: 'playlist', playlist_id: r.container_id, position: r.position });
    next.track_index_by_spotify_id[r.spotify_id] = row;
  }
  return next;
}
