/**
 * G3-D.3 採用模擬（僅 30 首有 D.3 建議；200 首波次指標外推說明）
 */
import fs from 'node:fs';
import { load_unified_classification_view } from '../g3_c/build_unified_view.js';
import { compute_g3_unified_playlist_preview } from '../g3_c/g3_smart_playlist_preview.js';
import { PREVIEW_MODE_BALANCED, PREVIEW_MODE_RELAXED } from '../preview_settings.js';
import { auto_review_ai_draft_with_quality } from './auto_review_quality.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { FILE_G3_D1_SAMPLE_200 } from './paths_d1.js';

function tier_allowed_balanced(tier) {
  return tier === 'high' || tier === 'medium';
}

function wave_row_metrics(row, d3_row, ev, rule) {
  const pk = d3_row
    ? d3_row.genre_profile.primary_genre
    : row.primary_genre.value;
  const tier = d3_row ? d3_row.confidence_tier : row.ai_confidence_tier;
  const review = auto_review_ai_draft_with_quality(
    ev,
    rule,
    d3_row || null
  );
  return { pk: pk, tier: tier, quality_status: review.quality_status };
}

/**
 * @param {Record<string, object>} d3_by_id
 */
export function simulate_d3_adoption_preview(d3_by_id) {
  const doc = load_unified_classification_view();
  const sample = JSON.parse(fs.readFileSync(FILE_G3_D1_SAMPLE_200, 'utf8'));
  const wave_ids = sample.track_ids;
  const ev_all = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks;

  const balanced_now = compute_g3_unified_playlist_preview(
    {},
    PREVIEW_MODE_BALANCED,
    doc
  );
  const relaxed_now = compute_g3_unified_playlist_preview(
    {},
    PREVIEW_MODE_RELAXED,
    doc
  );

  function aggregate(use_d3_for_30) {
    let soundtrack = 0;
    let unknown = 0;
    let quality_ok = 0;
    let needs_evidence = 0;
    let classification_unknown = 0;
    let balanced_eligible = 0;

    for (let i = 0; i < wave_ids.length; i += 1) {
      const id = wave_ids[i];
      const row = doc.tracks[id];
      if (!row) {
        continue;
      }
      const d3 =
        use_d3_for_30 && d3_by_id[id] ? d3_by_id[id] : null;
      const ev = ev_all[id] || { identity: {} };
      const rule = ev_all[id] ? rule_classify_track(ev_all[id]) : {};
      const m = wave_row_metrics(row, d3, ev, rule);
      if (m.pk === 'soundtrack_instrumental') {
        soundtrack += 1;
      }
      if (m.pk === 'unknown') {
        unknown += 1;
      }
      if (m.quality_status === 'quality_ok') {
        quality_ok += 1;
      } else if (m.quality_status === 'needs_evidence') {
        needs_evidence += 1;
      } else if (m.quality_status === 'classification_unknown') {
        classification_unknown += 1;
      }
      if (row.title && tier_allowed_balanced(m.tier)) {
        balanced_eligible += 1;
      }
    }
    return {
      soundtrack_instrumental: soundtrack,
      unknown_primary: unknown,
      quality_ok: quality_ok,
      needs_evidence: needs_evidence,
      classification_unknown: classification_unknown,
      wave_balanced_eligible_estimate: balanced_eligible,
    };
  }

  const d1_only = aggregate(false);
  const d3_partial_30 = aggregate(true);

  const d3_ids = Object.keys(d3_by_id);
  let balanced_delta_30 = 0;
  for (let j = 0; j < d3_ids.length; j += 1) {
    const id = d3_ids[j];
    const row = doc.tracks[id];
    const d3 = d3_by_id[id];
    if (!row || !d3) {
      continue;
    }
    const before = tier_allowed_balanced(row.ai_confidence_tier);
    const after = tier_allowed_balanced(d3.confidence_tier);
    if (!before && after) {
      balanced_delta_30 += 1;
    }
    if (before && !after) {
      balanced_delta_30 -= 1;
    }
  }

  return {
    schema_version: 1,
    simulation_scope_zh:
      '全庫 preview 總數僅 30 首替換 D.3；200 首波次指標為全波 d1 vs 30 首 d3＋其餘 d1',
    library_preview: {
      balanced_total_now: balanced_now.breakdown.total_unique,
      relaxed_total_now: relaxed_now.breakdown.total_unique,
      balanced_total_if_plus_30_tier_fix:
        balanced_now.breakdown.total_unique + balanced_delta_30,
      balanced_delta_from_30_tracks_only: balanced_delta_30,
    },
    wave_200_metrics: {
      d1_as_imported: d1_only,
      if_adopt_d3_for_30_only: d3_partial_30,
      deltas: {
        soundtrack:
          d3_partial_30.soundtrack_instrumental - d1_only.soundtrack_instrumental,
        unknown: d3_partial_30.unknown_primary - d1_only.unknown_primary,
        quality_ok: d3_partial_30.quality_ok - d1_only.quality_ok,
        needs_evidence:
          d3_partial_30.needs_evidence - d1_only.needs_evidence,
        classification_unknown:
          d3_partial_30.classification_unknown -
          d1_only.classification_unknown,
      },
    },
    note_zh: '未正式切換 unified view；Lemon Tree 等未涉及',
  };
}
