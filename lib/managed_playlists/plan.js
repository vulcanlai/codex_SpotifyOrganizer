/**
 * 可審核 plan：確認前不更新正式規則或基準。
 */
import { MANAGED_PLAYLIST_PLAN_SCHEMA } from './constants.js';
import { plan_body_hash, sha256_json } from './fingerprint.js';

export function build_readback_plan(params) {
  const p = params || {};
  const diff = p.diff || { playlists: [], possible_moves: [] };
  const playlists = (diff.playlists || []).map(function (row) {
    return {
      spotify_playlist_id: row.spotify_playlist_id,
      previous_name: row.previous_name,
      current_name: row.current_name,
      name_changed: row.name_changed === true,
      snapshot_id_before: row.snapshot_id_before || null,
      snapshot_id_after: row.snapshot_id_after || null,
      snapshot_changed: row.snapshot_changed === true,
      is_new: row.is_new === true,
      kind: row.kind || (row.is_new ? 'custom' : 'template'),
      skipped_unchanged: row.skipped_unchanged === true,
      status: row.status,
      can_edit: row.can_edit === true,
      capability_reason: row.capability_reason || null,
      items_complete: row.items_complete === true,
      changed_during_read: row.changed_during_read === true,
      incomplete: row.incomplete === true,
      added: (row.items_diff && row.items_diff.added) || [],
      removed: (row.items_diff && row.items_diff.removed) || [],
      order_changed: !!(row.items_diff && row.items_diff.order_changed),
      repeat_counts: (row.items_diff && row.items_diff.repeat_counts) || {},
      items: row.items || null,
      conflicts: row.conflicts || [],
      item_history_proven: row.item_history_proven === true,
      inferred_catalog_only: row.inferred_catalog_only || [],
      inferred_live_only: row.inferred_live_only || [],
    };
  });

  const summary = summarize_plan(playlists);
  const unusable = plan_has_unusable_items({ playlists: playlists });
  const apply_supported = summary.incomplete_count === 0 && !unusable;
  const official_item_baseline = p.official_item_baseline === true;
  const plan = {
    schema_version: MANAGED_PLAYLIST_PLAN_SCHEMA,
    mode: 'preview_only',
    apply_supported: apply_supported,
    applied: false,
    created_at: p.created_at || new Date().toISOString(),
    account_id: p.account_id || null,
    source: 'spotify_readonly_readback',
    baseline_fingerprint: p.baseline_fingerprint || null,
    live_list_fingerprint: p.live_list_fingerprint || null,
    read_cost: p.read_cost || null,
    playlists: playlists,
    possible_moves: diff.possible_moves || [],
    conflicts: playlists.flatMap(function (row) {
      return row.conflicts || [];
    }),
    summary: summary,
    human_baseline: {
      official_item_baseline: official_item_baseline,
      name_history_source: official_item_baseline ? 'official_baseline' : 'sync-manifest',
      item_history_source: official_item_baseline ? 'official_baseline' : 'none',
      catalog_comparison_available: p.catalog_comparison_available === true,
      lock_live_as_human_priority_on_apply: true,
      lock_inferred_catalog_absences_as_removals: true,
      catalog_absences_proven: false,
      note_zh: official_item_baseline
        ? '曲目增刪相對正式基準；分類缺席仍只是推定，確認後才鎖成該歌單人工移除。'
        : '沒有可信的歷史曲目基準。目前 Spotify 現況在確認後會成為人工優先基準；與分類不同的曲目只是推定，不能當成已證明的週末操作。不得與 cleanup-ledger 混為一談。',
    },
    notes_zh: [
      '讀回未修改 Spotify。',
      '確認前不會更新正式人工規則或同步基準。',
      '跨歌單移動僅展示為可能事件；各關係分別保存。',
      '未回傳／local／無效項目不是已刪除。',
      'cleanup-ledger 的歷史異常清理與人工刪歌是不同種類，不得互相推定。',
      apply_supported
        ? '此 plan 完整，仍須使用者確認後才可保存。'
        : '此 plan 不完整或含不可用快照，不能套用。',
    ],
  };
  plan.plan_hash = plan_body_hash(plan);
  return plan;
}

function summarize_plan(playlists) {
  const rows = playlists || [];
  return {
    playlist_count: rows.length,
    new_count: rows.filter(function (r) {
      return r.is_new;
    }).length,
    renamed_count: rows.filter(function (r) {
      return r.name_changed;
    }).length,
    unchanged_count: rows.filter(function (r) {
      return r.skipped_unchanged;
    }).length,
    incomplete_count: rows.filter(function (r) {
      return r.incomplete;
    }).length,
    readonly_count: rows.filter(function (r) {
      return r.can_edit === false && r.status !== 'active';
    }).length,
    conflict_count: rows.reduce(function (n, r) {
      return n + (r.conflicts ? r.conflicts.length : 0);
    }, 0),
    inferred_catalog_only_count: rows.reduce(function (n, r) {
      return n + ((r.inferred_catalog_only && r.inferred_catalog_only.length) || 0);
    }, 0),
    inferred_live_only_count: rows.reduce(function (n, r) {
      return n + ((r.inferred_live_only && r.inferred_live_only.length) || 0);
    }, 0),
  };
}

export function plan_has_unusable_items(plan) {
  const rows = (plan && plan.playlists) || [];
  for (let i = 0; i < rows.length; i += 1) {
    const items = rows[i].items;
    if (!Array.isArray(items) || !items.length) {
      continue;
    }
    let playable = 0;
    let unavailable = 0;
    for (let j = 0; j < items.length; j += 1) {
      const kind = items[j] && items[j].kind;
      if (kind === 'unavailable') {
        unavailable += 1;
      } else if (kind === 'track' || kind === 'episode' || kind === 'local') {
        playable += 1;
      }
    }
    if (unavailable > 0 && playable === 0) {
      return true;
    }
  }
  return false;
}

/**
 * 過期、來源基準變動、重複套用檢查。
 */
export function validate_plan_for_apply(plan, context) {
  const ctx = context || {};
  if (!plan || plan.schema_version !== MANAGED_PLAYLIST_PLAN_SCHEMA) {
    return { ok: false, reason_zh: 'plan 版本或格式不符' };
  }
  if (plan.applied === true || (ctx.applied_hashes && ctx.applied_hashes.has(plan.plan_hash))) {
    return { ok: false, reason_zh: '此 plan 已套用，拒絕重複套用' };
  }
  const expected = plan_body_hash(plan);
  if (plan.plan_hash !== expected) {
    return { ok: false, reason_zh: 'plan hash 不符，內容可能已被改動' };
  }
  if (ctx.expected_plan_hash && ctx.expected_plan_hash !== plan.plan_hash) {
    return { ok: false, reason_zh: '指定的 plan hash 與檔案不一致' };
  }
  if (plan.account_id && ctx.account_id && plan.account_id !== ctx.account_id) {
    return { ok: false, reason_zh: 'plan 來源帳號與目前帳號不符' };
  }
  if (
    plan.baseline_fingerprint &&
    ctx.current_baseline_fingerprint &&
    plan.baseline_fingerprint !== ctx.current_baseline_fingerprint
  ) {
    return { ok: false, reason_zh: '正式基準已變動，plan 過期，請重新讀回' };
  }
  if (
    plan.live_list_fingerprint &&
    ctx.current_live_list_fingerprint &&
    plan.live_list_fingerprint !== ctx.current_live_list_fingerprint
  ) {
    return { ok: false, reason_zh: 'Spotify 歌單清單版本已變動，plan 過期，請重新讀回' };
  }
  if (plan.apply_supported === false) {
    return { ok: false, reason_zh: '此 plan 標示為不可套用' };
  }
  if (plan.playlists.some(function (row) {
    return row.incomplete || row.changed_during_read;
  })) {
    return { ok: false, reason_zh: 'plan 含不完整或讀取中再次變動的歌單，不能當完整快照保存' };
  }
  if (plan_has_unusable_items(plan)) {
    return { ok: false, reason_zh: 'plan 含全數無法回傳的曲目快照，不能當完整基準保存' };
  }
  return { ok: true };
}

export function fingerprint_baseline(baseline) {
  return sha256_json({
    account_id: baseline && baseline.account_id,
    playlists: baseline && baseline.playlists,
  });
}

export function fingerprint_live_list(list) {
  return sha256_json(
    (list || []).map(function (p) {
      return [p.id, p.name, p.snapshot_id, p.tracks_total];
    })
  );
}
