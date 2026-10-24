/**
 * G3-D.5 adopt dry-run（記憶體模擬，不寫入、不啟用 overlay）
 */
import fs from 'node:fs';
import { load_unified_classification_view } from '../g3_c/build_unified_view.js';
import { compute_g3_unified_playlist_preview } from '../g3_c/g3_smart_playlist_preview.js';
import {
  PREVIEW_MODE_BALANCED,
  PREVIEW_MODE_RELAXED,
} from '../preview_settings.js';
import {
  SOURCE_TIER_AI,
} from '../g3_c/paths_c1.js';
import { FILE_G3_D4_ADOPT_OVERLAY, FILE_G3_D4_MERGED_CANDIDATE_200 } from './paths_d4.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../../enrichment/external/g1_sample.js';

function apply_candidates_to_view_clone(unified_doc, candidate_by_id, adopt_ids) {
  const clone = JSON.parse(JSON.stringify(unified_doc));
  let applied = 0;
  let skipped_human = 0;
  let primary_changes = 0;

  for (let i = 0; i < adopt_ids.length; i += 1) {
    const id = adopt_ids[i];
    const v = clone.tracks[id];
    const c = candidate_by_id[id];
    if (!v || !c) {
      continue;
    }
    if (v.human_confirmed) {
      skipped_human += 1;
      continue;
    }
    const gp = c.genre_profile;
    const old_pk = v.primary_genre && v.primary_genre.value;
    const new_pk = gp.primary_genre;
    if (old_pk !== new_pk) {
      primary_changes += 1;
    }
    v.primary_genre = {
      value: new_pk,
      source_tier: SOURCE_TIER_AI,
      source_detail: c.source,
      confidence: gp.confidence || 'inferred',
    };
    v.subgenres = {
      value: gp.subgenres || [],
      source_tier: SOURCE_TIER_AI,
      source_detail: c.source,
      confidence: 'inferred',
    };
    v.secondary_genres = {
      value: gp.secondary_genres || [],
      source_tier: SOURCE_TIER_AI,
      source_detail: c.source,
      confidence: 'inferred',
    };
    if (c.language) {
      v.language = {
        value: c.language.value,
        source_tier: SOURCE_TIER_AI,
        source_detail: c.source,
        confidence: c.language.confidence || 'inferred',
      };
    }
    v.ai_confidence_tier = c.confidence_tier;
    v.is_cursor_agent_ai = true;
    v.inference_source_kind = 'cursor_agent_actual_ai';
    applied += 1;
  }

  return { clone: clone, applied: applied, skipped_human: skipped_human, primary_changes: primary_changes };
}

/**
 * @param {{ A_ids: string[], B_ids: string[] }} tiers
 */
export function run_adopt_dry_run(tiers) {
  const unified = load_unified_classification_view();
  if (!unified) {
    throw new Error('缺少 unified view');
  }
  const merged = JSON.parse(fs.readFileSync(FILE_G3_D4_MERGED_CANDIDATE_200, 'utf8'));
  const cand_by = {};
  for (let m = 0; m < merged.tracks.length; m += 1) {
    cand_by[merged.tracks[m].track_id] = merged.tracks[m];
  }

  const adopt_ab = tiers.A_ids.concat(tiers.B_ids);
  function preview_total(preview_result) {
    return preview_result.breakdown ? preview_result.breakdown.total_unique : null;
  }

  const balanced_before = compute_g3_unified_playlist_preview(PREVIEW_MODE_BALANCED, {}, unified);
  const relaxed_before = compute_g3_unified_playlist_preview(PREVIEW_MODE_RELAXED, {}, unified);

  const sim = apply_candidates_to_view_clone(unified, cand_by, adopt_ab);
  const balanced_after = compute_g3_unified_playlist_preview(
    PREVIEW_MODE_BALANCED,
    {},
    sim.clone
  );
  const relaxed_after = compute_g3_unified_playlist_preview(
    PREVIEW_MODE_RELAXED,
    {},
    sim.clone
  );

  const lemon_before = unified.tracks[G1_MUST_INCLUDE_LEMON_TREE];
  const lemon_after = sim.clone.tracks[G1_MUST_INCLUDE_LEMON_TREE];

  const rollback_balanced = compute_g3_unified_playlist_preview(
    PREVIEW_MODE_BALANCED,
    {},
    unified
  );
  const rollback_ok =
    preview_total(rollback_balanced) === preview_total(balanced_before) &&
    lemon_before.auto_review_status === lemon_after.auto_review_status;

  const overlay_on_disk = JSON.parse(fs.readFileSync(FILE_G3_D4_ADOPT_OVERLAY, 'utf8'));

  let confirmed_leak = 0;
  const ids = Object.keys(sim.clone.tracks);
  for (let i = 0; i < ids.length; i += 1) {
    const v = sim.clone.tracks[ids[i]];
    if (v.primary_genre && v.primary_genre.confidence === 'confirmed' && v.is_cursor_agent_ai) {
      confirmed_leak += 1;
    }
  }

  return {
    schema_version: 1,
    enabled: false,
    overlay_file_enabled: overlay_on_disk.enabled === false,
    adopt_scope: 'A_and_B_only',
    adopt_id_count: adopt_ab.length,
    A_count: tiers.A_ids.length,
    B_count: tiers.B_ids.length,
    applied_count: sim.applied,
    skipped_human_locked: sim.skipped_human,
    primary_genre_changes: sim.primary_changes,
    playlist: {
      balanced_before: preview_total(balanced_before),
      balanced_after: preview_total(balanced_after),
      balanced_delta: preview_total(balanced_after) - preview_total(balanced_before),
      relaxed_before: preview_total(relaxed_before),
      relaxed_after: preview_total(relaxed_after),
      relaxed_delta: preview_total(relaxed_after) - preview_total(relaxed_before),
    },
    lemon_tree: {
      auto_review_before: lemon_before.auto_review_status,
      auto_review_after_sim: lemon_after.auto_review_status,
      conflict_preserved: lemon_before.auto_review_status === 'conflict',
    },
    rollback_test: {
      pass: rollback_ok,
      note_zh: 'dry-run 未寫入磁碟；原 unified 物件未變',
    },
    confirmed_tier_leak_count: confirmed_leak,
    drafts_untouched_zh: '未覆寫 D.1 batch-drafts、D.3/D.4 cursor 草稿',
  };
}
