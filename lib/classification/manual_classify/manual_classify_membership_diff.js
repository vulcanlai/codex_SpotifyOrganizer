/**
 * 人工分類：歌曲 × 歌單歸屬差異（增量合併語意）
 */
import crypto from 'node:crypto';
import { merge_track_override_patch } from './override_patch.js';

/**
 * @param {object} plan
 */
export function target_playlist_ids_from_plan(plan) {
  const shared = (plan && plan.shared_patch) || {};
  /** @type {object[]} */
  const targets = [];
  const mvp = shared.mvp_playlist_ids || [];
  for (let i = 0; i < mvp.length; i += 1) {
    targets.push({ playlist_id: mvp[i], kind: 'mvp' });
  }
  const emo = shared.emotion_playlist_ids || [];
  for (let j = 0; j < emo.length; j += 1) {
    targets.push({ playlist_id: emo[j], kind: 'emotion' });
  }
  return targets;
}

/**
 * @param {object|null} prev
 * @param {string} playlist_id
 * @param {string} kind
 */
function prev_has_playlist_membership(prev, playlist_id, kind) {
  if (!prev) {
    return false;
  }
  const list =
    kind === 'emotion' ? prev.emotion_playlist_ids || [] : prev.mvp_playlist_ids || [];
  return list.indexOf(playlist_id) >= 0;
}

/**
 * @param {object} plan
 */
export function compute_plan_membership_summary(plan) {
  const targets = target_playlist_ids_from_plan(plan);
  const tracks = (plan && plan.tracks) || [];
  let total_target_slots = 0;
  let existing_target_slots = 0;
  let pending_target_slots = 0;
  let tracks_needing_update = 0;
  let tracks_fully_classified = 0;
  let tracks_not_in_library = 0;
  let writable_tracks = 0;

  for (let t = 0; t < tracks.length; t += 1) {
    const row = tracks[t];
    if (!row.in_library) {
      tracks_not_in_library += 1;
      continue;
    }
    if (!row.validation || !row.validation.ok) {
      continue;
    }
    writable_tracks += 1;
    const prev = row.previous_override || null;
    let track_pending = 0;
    for (let p = 0; p < targets.length; p += 1) {
      const tg = targets[p];
      total_target_slots += 1;
      if (prev_has_playlist_membership(prev, tg.playlist_id, tg.kind)) {
        existing_target_slots += 1;
      } else {
        pending_target_slots += 1;
        track_pending += 1;
      }
    }
    if (targets.length === 0) {
      continue;
    }
    if (track_pending === 0) {
      tracks_fully_classified += 1;
    } else {
      tracks_needing_update += 1;
    }
  }

  let apply_status = 'none_pending';
  if (pending_target_slots > 0 && existing_target_slots > 0) {
    apply_status = 'partial';
  } else if (pending_target_slots > 0) {
    apply_status = 'all_new';
  } else if (total_target_slots > 0) {
    apply_status = 'complete';
  }

  return {
    target_playlist_count: targets.length,
    track_count: tracks.length,
    total_target_slots: total_target_slots,
    existing_target_slots: existing_target_slots,
    pending_target_slots: pending_target_slots,
    tracks_needing_update: tracks_needing_update,
    tracks_fully_classified: tracks_fully_classified,
    tracks_not_in_library: tracks_not_in_library,
    writable_tracks: writable_tracks,
    apply_status: apply_status,
    has_pending_writes: count_plan_pending_writes(plan) > 0,
  };
}

/**
 * 實際會寫入的曲目數（合併後與 prev 不同）
 * @param {object} plan
 */
export function count_plan_pending_writes(plan) {
  const tracks = (plan && plan.tracks) || [];
  let n = 0;
  for (let i = 0; i < tracks.length; i += 1) {
    const row = tracks[i];
    if (!row.in_library || !row.validation || !row.validation.ok) {
      continue;
    }
    if (row.changed) {
      n += 1;
    }
  }
  return n;
}

/**
 * @param {object} plan
 */
export function plan_has_incremental_playlist_work(plan) {
  const summary = compute_plan_membership_summary(plan);
  return summary.pending_target_slots > 0 && summary.has_pending_writes;
}

/**
 * @param {object|null} doc
 */
export function compute_overrides_fingerprint(doc) {
  const d = doc || { updated_at: null, overrides_by_track_id: {} };
  const keys = Object.keys(d.overrides_by_track_id || {}).sort();
  const payload = {
    updated_at: d.updated_at || null,
    override_count: keys.length,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * 單曲歸屬明細（本次選取的歌單）
 * @param {object} track_row - plan.tracks 項目
 * @param {object[]} target_playlists
 */
export function per_track_membership_detail(track_row, target_playlists) {
  const prev = track_row.previous_override || null;
  /** @type {string[]} */
  const pending_ids = [];
  /** @type {string[]} */
  const already_ids = [];
  for (let i = 0; i < target_playlists.length; i += 1) {
    const tg = target_playlists[i];
    if (prev_has_playlist_membership(prev, tg.playlist_id, tg.kind)) {
      already_ids.push(tg.playlist_id);
    } else {
      pending_ids.push(tg.playlist_id);
    }
  }
  const prev_mvp = (prev && prev.mvp_playlist_ids) || [];
  const prev_emo = (prev && prev.emotion_playlist_ids) || [];
  const target_set = {};
  for (let t = 0; t < target_playlists.length; t += 1) {
    target_set[target_playlists[t].playlist_id] = true;
  }
  /** @type {string[]} */
  const other_mvp = [];
  /** @type {string[]} */
  const other_emo = [];
  for (let m = 0; m < prev_mvp.length; m += 1) {
    if (!target_set[prev_mvp[m]]) {
      other_mvp.push(prev_mvp[m]);
    }
  }
  for (let e = 0; e < prev_emo.length; e += 1) {
    if (!target_set[prev_emo[e]]) {
      other_emo.push(prev_emo[e]);
    }
  }
  return {
    pending_playlist_ids: pending_ids,
    already_target_playlist_ids: already_ids,
    other_mvp_playlist_ids: other_mvp,
    other_emotion_playlist_ids: other_emo,
  };
}

/**
 * 驗證 merge 為增量 union（測試用）
 * @param {object|null} prev
 * @param {object} shared_patch
 */
export function merged_playlists_preserve_prev(prev, shared_patch) {
  const merged = merge_track_override_patch(prev, shared_patch);
  const prev_mvp = (prev && prev.mvp_playlist_ids) || [];
  const prev_emo = (prev && prev.emotion_playlist_ids) || [];
  for (let i = 0; i < prev_mvp.length; i += 1) {
    if ((merged.mvp_playlist_ids || []).indexOf(prev_mvp[i]) < 0) {
      return false;
    }
  }
  for (let j = 0; j < prev_emo.length; j += 1) {
    if ((merged.emotion_playlist_ids || []).indexOf(prev_emo[j]) < 0) {
      return false;
    }
  }
  return true;
}
