/**
 * 本機智慧歌單預覽（未同步 Spotify）
 */
import { build_formal_classification_state } from './formal_state_build.js';
import { load_classification_settings, PREVIEW_MODE_BALANCED } from './preview_settings.js';
import {
  evaluate_preview_inclusion,
  effective_genre_profile_for_preview,
  effective_tags_for_preview,
} from './preview_mode.js';
import {
  FORMAL_CONFIRMED,
  FORMAL_AI_SUGGESTED,
  FORMAL_UNKNOWN,
  FORMAL_REJECTED,
} from './classification_state.js';
import { TIER_HIGH, TIER_MEDIUM, TIER_LOW } from './confidence_tier.js';
import fs from 'node:fs';
import {
  FILE_AI_CANDIDATES_V2,
  FILE_AI_REVIEW_V2,
} from './paths.js';
import {
  TEST_BATCH_V2_30,
  TEST_BATCH_PHASE_E_100,
  FILE_PHASE_E_CANDIDATES_IMPORTED,
  FILE_PHASE_E_REVIEW,
} from './ai_test_batches.js';
import { load_manual_overrides } from './overrides_store.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function find_candidate(doc, id) {
  const list = doc && doc.candidates ? doc.candidates : [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].spotify_id === id) {
      return list[i];
    }
  }
  return null;
}

function has_tag(tags, dimension, value) {
  for (let i = 0; i < (tags || []).length; i += 1) {
    if (tags[i].dimension === dimension && tags[i].value === value) {
      return true;
    }
  }
  return false;
}

function match_filters(row, tags, gp, filters) {
  if (filters.decade && !has_tag(tags, 'decade', filters.decade)) {
    return false;
  }
  if (filters.language && !has_tag(tags, 'language', filters.language)) {
    return false;
  }
  if (filters.context && !has_tag(tags, 'context', filters.context)) {
    return false;
  }
  if (filters.primary_genre) {
    const pk = (gp && gp.primary_genre) || 'unknown';
    if (pk !== filters.primary_genre) {
      return false;
    }
  }
  if (filters.subgenre) {
    const subs = (gp && gp.subgenres) || [];
    if (subs.indexOf(filters.subgenre) < 0) {
      return false;
    }
  }
  return true;
}

/**
 * @param {object} index_doc
 * @param {object} filters
 * @param {string} [mode_override]
 */
export function compute_smart_playlist_preview(index_doc, filters, mode_override) {
  const settings = load_classification_settings();
  const mode = mode_override || settings.preview_mode || PREVIEW_MODE_BALANCED;
  const formal_doc = build_formal_classification_state(index_doc, { write: false });

  const v2 = read_json(FILE_AI_CANDIDATES_V2);
  const v2_review = read_json(FILE_AI_REVIEW_V2);
  const phase_c = read_json(FILE_PHASE_E_CANDIDATES_IMPORTED);
  const phase_review = read_json(FILE_PHASE_E_REVIEW);
  const overrides = load_manual_overrides();

  const tracks = index_doc.tracks_by_id || {};
  const ids = Object.keys(tracks).sort();
  const seen = {};
  const breakdown = {
    total_unique: 0,
    confirmed: 0,
    ai_unreviewed: 0,
    insufficient: 0,
    tier: { high: 0, medium: 0, low: 0 },
  };

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (seen[id]) {
      continue;
    }
    const row = tracks[id];
    const st = formal_doc.states_by_track_id[id];
    let batch_candidate = null;
    let batch_rev = null;
    if (st.test_batch_id === TEST_BATCH_V2_30) {
      batch_candidate = v2 ? find_candidate(v2, id) : null;
      batch_rev =
        v2_review && v2_review.reviews_by_track_id
          ? v2_review.reviews_by_track_id[id]
          : null;
    } else if (st.test_batch_id === TEST_BATCH_PHASE_E_100) {
      batch_candidate = phase_c ? find_candidate(phase_c, id) : null;
      batch_rev =
        phase_review && phase_review.reviews_by_track_id
          ? phase_review.reviews_by_track_id[id]
          : null;
    }

    const ctx = {
      formal_state: st.formal_state,
      confidence_tier: st.confidence_tier,
      index_genre_profile: row.genre_profile,
      index_tags: row.tags,
      v2_candidate: batch_candidate,
      override_row: overrides.overrides_by_track_id[id] || null,
      v2_review: batch_rev,
      in_ai_sample: st.ai_sample === true,
    };

    const inclusion = evaluate_preview_inclusion(ctx, mode);
    if (!inclusion.included) {
      if (st.formal_state === FORMAL_UNKNOWN || st.formal_state === FORMAL_REJECTED) {
        breakdown.insufficient += 1;
      }
      continue;
    }

    const gp = effective_genre_profile_for_preview(ctx, inclusion);
    const tags = effective_tags_for_preview(ctx, inclusion) || row.tags;
    if (!match_filters(row, tags, gp, filters || {})) {
      continue;
    }

    seen[id] = true;
    breakdown.total_unique += 1;

    if (st.formal_state === FORMAL_CONFIRMED) {
      breakdown.confirmed += 1;
    } else if (st.formal_state === FORMAL_AI_SUGGESTED) {
      breakdown.ai_unreviewed += 1;
    }

    const tier = st.confidence_tier || TIER_LOW;
    breakdown.tier[tier] = (breakdown.tier[tier] || 0) + 1;
  }

  return {
    preview_mode: mode,
    local_only: true,
    not_synced_spotify: true,
    filters: filters || {},
    breakdown,
  };
}

/**
 * 比較三種模式（同篩選條件）
 */
export function compare_preview_modes(index_doc, filters) {
  const modes = ['strict', 'balanced', 'relaxed'];
  const out = {};
  for (let i = 0; i < modes.length; i += 1) {
    out[modes[i]] = compute_smart_playlist_preview(index_doc, filters, modes[i]);
  }
  return out;
}
