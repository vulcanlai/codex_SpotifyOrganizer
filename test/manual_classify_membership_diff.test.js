/**
 * 人工分類：歌曲×歌單歸屬差異與 no_changes
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compute_plan_membership_summary,
  count_plan_pending_writes,
  merged_playlists_preserve_prev,
  compute_overrides_fingerprint,
} from '../lib/classification/manual_classify/manual_classify_membership_diff.js';
import {
  build_manual_classify_plan,
  apply_manual_classify_plan,
} from '../lib/classification/manual_classify/manual_classify_core.js';
import {
  run_manual_classify_apply,
  run_manual_classify_preview,
  format_manual_classify_preview_for_ui,
  reset_manual_classify_apply_state_for_tests,
} from '../lib/classification/manual_classify/manual_classify_web_service.js';
import { empty_overrides_doc } from '../lib/classification/overrides_store.js';
import { merge_track_override_patch } from '../lib/classification/manual_classify/override_patch.js';

const PL_A = 'lg:v2:english:soundtrack_instrumental';
const PL_B = 'emotion:late_night_calm';

function make_track_ids(n, series) {
  /** @type {string[]} */
  const ids = [];
  const base = series || 1;
  for (let i = 0; i < n; i += 1) {
    const num = base + i;
    ids.push('000000000000000000' + String(num).padStart(4, '0'));
  }
  return ids;
}

function overrides_all_tracks(tracks, mvp, emo) {
  const doc = empty_overrides_doc();
  for (let i = 0; i < tracks.length; i += 1) {
    doc.overrides_by_track_id[tracks[i]] = {
      source: 'test',
      mvp_playlist_ids: mvp.slice(),
      emotion_playlist_ids: emo.slice(),
    };
  }
  return doc;
}

function synthetic_plan_with_tracks(track_rows, playlist_ids) {
  /** @type {object} */
  const shared = { mvp_playlist_ids: [], emotion_playlist_ids: [] };
  for (let i = 0; i < playlist_ids.length; i += 1) {
    const pid = playlist_ids[i];
    if (pid.indexOf('emotion:') === 0) {
      shared.emotion_playlist_ids.push(pid);
    } else {
      shared.mvp_playlist_ids.push(pid);
    }
  }
  return {
    ok: true,
    shared_patch: shared,
    tracks: track_rows,
  };
}

test('1. 10 首 × 2 歌單＝20 歸屬已全部存在 → pending 0', function () {
  /** @type {object[]} */
  const rows = [];
  for (let i = 0; i < 10; i += 1) {
    const tid = '000000000000000000' + String(1000 + i);
    rows.push({
      track_id: tid,
      in_library: true,
      validation: { ok: true },
      previous_override: {
        mvp_playlist_ids: [PL_A],
        emotion_playlist_ids: [PL_B],
      },
      changed: false,
    });
  }
  const plan = synthetic_plan_with_tracks(rows, [PL_A, PL_B]);
  plan.membership_summary = compute_plan_membership_summary(plan);
  assert.equal(plan.membership_summary.total_target_slots, 20);
  assert.equal(plan.membership_summary.pending_target_slots, 0);
  assert.equal(count_plan_pending_writes(plan), 0);
});

test('2. 20 歸屬已存在 12 → pending 8', function () {
  /** @type {object[]} */
  const rows = [];
  for (let i = 0; i < 10; i += 1) {
    const tid = '000000000000000000' + String(2000 + i);
    const prev =
      i < 2
        ? { mvp_playlist_ids: [PL_A], emotion_playlist_ids: [PL_B] }
        : { mvp_playlist_ids: [PL_A] };
    rows.push({
      track_id: tid,
      in_library: true,
      validation: { ok: true },
      previous_override: prev,
      changed: i >= 2,
    });
  }
  const plan = synthetic_plan_with_tracks(rows, [PL_A, PL_B]);
  plan.membership_summary = compute_plan_membership_summary(plan);
  assert.equal(plan.membership_summary.existing_target_slots, 12);
  assert.equal(plan.membership_summary.pending_target_slots, 8);
});

test('3. 增量合併保留未勾選的其他歌單', function () {
  const prev = {
    mvp_playlist_ids: [PL_A, 'lg:v2:english:folk'],
    emotion_playlist_ids: ['emotion:relaxed_comfort'],
  };
  const shared = { mvp_playlist_ids: [PL_B], emotion_playlist_ids: [] };
  assert.equal(merged_playlists_preserve_prev(prev, shared), true);
  const merged = merge_track_override_patch(prev, shared);
  assert.ok(merged.mvp_playlist_ids.indexOf('lg:v2:english:folk') >= 0);
  assert.ok(merged.emotion_playlist_ids.indexOf('emotion:relaxed_comfort') >= 0);
});

test('4. apply no_changes 不備份', function () {
  const plan = synthetic_plan_with_tracks(
    [
      {
        track_id: '0000000000000000003001',
        in_library: true,
        validation: { ok: true },
        previous_override: { mvp_playlist_ids: [PL_A] },
        changed: false,
      },
    ],
    [PL_A]
  );
  const res = apply_manual_classify_plan(plan, { write: false });
  assert.equal(res.result, 'no_changes');
  assert.equal(res.writes, 0);
});

test('5. Web apply 無 pending 回傳 no_changes（記憶體 plan）', function () {
  const plan = synthetic_plan_with_tracks(
    [
      {
        track_id: '0000000000000000004001',
        in_library: true,
        validation: { ok: true },
        previous_override: {
          mvp_playlist_ids: [PL_A],
          emotion_playlist_ids: [PL_B],
        },
        changed: false,
      },
    ],
    [PL_A, PL_B]
  );
  const res = apply_manual_classify_plan(plan, { write: false });
  assert.equal(res.result, 'no_changes');
});

test('6. stale fingerprint 拒絕寫入', function () {
  reset_manual_classify_apply_state_for_tests();
  const body = {
    spotify_input: '0000000000000000000050',
    spotify_id_kind: 'track',
    playlist_ids: [PL_A],
  };
  const prev = run_manual_classify_preview(body);
  assert.equal(prev.ok, true);
  const res = run_manual_classify_apply({
    confirm: true,
    preview_token: prev.preview_token,
    overrides_fingerprint: 'deadbeef000000000000000000000000000000000000000000000000000000',
    request: body,
  });
  assert.equal(res.error, 'stale_preview');
});

test('7. G3-F adopted 仍保留 registry 提示', function () {
  const tid = '0000000000000000000060';
  const plan = build_manual_classify_plan({
    track_tokens: tid,
    spotify_id_kind: 'track',
    primary_genre: 'folk',
    playlist_ids: [PL_A],
    overrides_doc: empty_overrides_doc(),
    registry_doc: {
      adoptions_by_track_id: {
        [tid]: { status: 'adopted' },
      },
    },
  });
  assert.equal(plan.tracks[0].g3_f_registry_status, 'adopted');
  assert.ok(plan.tracks[0].conflicts.length >= 1);
});

test('8. Dragon Age 純 album ID 仍解析 10 首', function () {
  const plan = build_manual_classify_plan({
    album: '14W5TKHpGghGbgFlkxfbWm',
    playlist_ids: [PL_A],
    overrides_doc: empty_overrides_doc(),
  });
  assert.equal(plan.tracks.length, 10);
});

test('9. 預覽 format 含 membership_summary', function () {
  const tracks = make_track_ids(1, '0000000000000000000070');
  const prev = run_manual_classify_preview({
    spotify_input: tracks[0],
    spotify_id_kind: 'track',
    playlist_ids: [PL_A],
  });
  assert.ok(prev.preview.membership_summary);
  assert.ok(typeof prev.preview.apply_status_message_zh === 'string');
});

test('10. UI can_apply 後端：pending 0 則 can_apply false', function () {
  /** @type {object[]} */
  const rows = [];
  for (let i = 0; i < 3; i += 1) {
    rows.push({
      track_id: '000000000000000000' + String(8000 + i),
      in_library: true,
      validation: { ok: true },
      previous_override: {
        mvp_playlist_ids: [PL_A],
        emotion_playlist_ids: [PL_B],
      },
      changed: false,
    });
  }
  const plan2 = synthetic_plan_with_tracks(rows, [PL_A, PL_B]);
  plan2.membership_summary = compute_plan_membership_summary(plan2);
  plan2.playlist_resolution = { resolved: [], blocked: [] };
  plan2.blocked_reasons = [];
  plan2.targets = { id_resolution: { blocked: false } };
  assert.equal(plan2.membership_summary.pending_target_slots, 0);
  const ui = format_manual_classify_preview_for_ui(plan2);
  assert.equal(ui.can_apply, false);
  assert.equal(ui.apply_status, 'complete');
});
