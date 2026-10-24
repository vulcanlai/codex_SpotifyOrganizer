/**
 * G3-C.1 智慧歌單預覽（統一檢視 + 來源分層）
 */
import {
  PREVIEW_MODE_STRICT,
  PREVIEW_MODE_BALANCED,
  PREVIEW_MODE_RELAXED,
} from '../preview_settings.js';
import { load_unified_classification_view } from './build_unified_view.js';
import { analyze_sample_100_preview_gap } from './g3_c2_acceptance.js';
import {
  SOURCE_TIER_HUMAN,
  SOURCE_TIER_EVIDENCE,
  SOURCE_TIER_AI,
} from './paths_c1.js';

function tier_allowed_for_mode(field_tier, mode, ai_confidence_tier) {
  if (field_tier === SOURCE_TIER_HUMAN || field_tier === SOURCE_TIER_EVIDENCE) {
    return true;
  }
  if (field_tier !== SOURCE_TIER_AI) {
    return false;
  }
  if (mode === PREVIEW_MODE_STRICT) {
    return false;
  }
  if (mode === PREVIEW_MODE_RELAXED) {
    return true;
  }
  return ai_confidence_tier === 'high' || ai_confidence_tier === 'medium';
}

function match_unified_filters(view_row, filters) {
  const f = filters || {};
  if (f.primary_genre) {
    const pk = view_row.primary_genre && view_row.primary_genre.value;
    if (pk !== f.primary_genre) {
      return false;
    }
  }
  if (f.subgenre) {
    const subs = (view_row.subgenres && view_row.subgenres.value) || [];
    if (subs.indexOf(f.subgenre) < 0) {
      return false;
    }
  }
  if (f.language) {
    const lang = view_row.language && view_row.language.value;
    if (lang !== f.language) {
      return false;
    }
  }
  if (f.context) {
    const ctx = (view_row.contexts && view_row.contexts.value) || [];
    if (ctx.indexOf(f.context) < 0) {
      return false;
    }
  }
  if (f.special_type) {
    const st = (view_row.special_types && view_row.special_types.value) || [];
    if (st.indexOf(f.special_type) < 0) {
      return false;
    }
  }
  return true;
}

/**
 * @param {object} filters
 * @param {string} mode
 * @param {object} [unified_doc]
 */
export function compute_g3_unified_playlist_preview(filters, mode, unified_doc) {
  const doc = unified_doc || load_unified_classification_view();
  if (!doc || !doc.tracks) {
    return {
      preview_mode: mode,
      local_only: true,
      not_synced_spotify: true,
      g3_unified: false,
      error: '缺少 unified-classification-view.json',
    };
  }

  const m = mode || PREVIEW_MODE_BALANCED;
  const ids = Object.keys(doc.tracks).sort();
  const breakdown = {
    total_unique: 0,
    by_provenance: {
      human_confirmed: 0,
      verified_evidence: 0,
      ai_suggestion: 0,
      unknown: 0,
    },
    auto_review: { pass: 0, needs_evidence: 0, conflict: 0, other: 0 },
    in_g3_sample_100: 0,
  };

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const row = doc.tracks[id];
    if (!row.title) {
      continue;
    }
    const pk_tier = row.primary_genre.source_tier;
    if (!tier_allowed_for_mode(pk_tier, m, row.ai_confidence_tier)) {
      continue;
    }
    if (!match_unified_filters(row, filters)) {
      continue;
    }

    breakdown.total_unique += 1;
    if (row.human_confirmed) {
      breakdown.by_provenance.human_confirmed += 1;
    } else if (pk_tier === SOURCE_TIER_EVIDENCE) {
      breakdown.by_provenance.verified_evidence += 1;
    } else if (pk_tier === SOURCE_TIER_AI) {
      breakdown.by_provenance.ai_suggestion += 1;
    } else {
      breakdown.by_provenance.unknown += 1;
    }

    if (row.in_g3_sample_100) {
      breakdown.in_g3_sample_100 += 1;
    }
    const ar = row.auto_review_status;
    if (ar === 'pass') {
      breakdown.auto_review.pass += 1;
    } else if (ar === 'needs_evidence') {
      breakdown.auto_review.needs_evidence += 1;
    } else if (ar === 'conflict') {
      breakdown.auto_review.conflict += 1;
    } else {
      breakdown.auto_review.other += 1;
    }
  }

  const empty_filters = !filters || Object.keys(filters).every(function (k) {
    return !filters[k];
  });
  let sample_100_gap = null;
  if (empty_filters && m === PREVIEW_MODE_BALANCED) {
    sample_100_gap = analyze_sample_100_preview_gap(doc);
  }

  return {
    preview_mode: m,
    local_only: true,
    not_synced_spotify: true,
    g3_unified: true,
    filters: filters || {},
    breakdown: breakdown,
    sample_100_balanced_gap: sample_100_gap,
  };
}
