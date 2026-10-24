/**
 * 重建 formal-classification-state.json（不修改 ai-review）
 */
import fs from 'node:fs';
import {
  CLASSIFICATION_DIR,
  FILE_AI_SAMPLE,
  FILE_AI_CANDIDATES_V2,
  FILE_AI_REVIEW_V2,
  FILE_FORMAL_CLASSIFICATION_STATE,
  FORMAL_CLASSIFICATION_STATE_SCHEMA_VERSION,
  AI_CANDIDATE_VERSION_V2,
} from './paths.js';
import {
  FILE_PHASE_E_SAMPLE,
  FILE_PHASE_E_CANDIDATES_IMPORTED,
  FILE_PHASE_E_REVIEW,
  TEST_BATCH_V2_30,
  TEST_BATCH_PHASE_E_100,
} from './ai_test_batches.js';
import { write_json_atomic } from '../atomic_json.js';
import { load_manual_overrides } from './overrides_store.js';
import { load_g3_f_adopt_registry } from './g3_f/g3_f_adopt_registry_store.js';
import { resolve_formal_classification_state } from './classification_state.js';
import { compute_confidence_tier } from './confidence_tier.js';

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

function build_batch_maps() {
  const v2_sample = read_json(FILE_AI_SAMPLE);
  const phase_sample = read_json(FILE_PHASE_E_SAMPLE);
  const v2_set = {};
  const phase_set = {};
  if (v2_sample && v2_sample.track_ids) {
    for (let i = 0; i < v2_sample.track_ids.length; i += 1) {
      v2_set[v2_sample.track_ids[i]] = true;
    }
  }
  if (phase_sample && phase_sample.track_ids) {
    for (let i = 0; i < phase_sample.track_ids.length; i += 1) {
      phase_set[phase_sample.track_ids[i]] = true;
    }
  }
  return { v2_set, phase_set, v2_sample, phase_sample };
}

function resolve_track_batch(id, maps) {
  if (maps.v2_set[id]) {
    return TEST_BATCH_V2_30;
  }
  if (maps.phase_set[id]) {
    return TEST_BATCH_PHASE_E_100;
  }
  return null;
}

/**
 * @param {object} index_doc
 * @param {object} [opts]
 */
export function build_formal_classification_state(index_doc, opts) {
  const options = opts || {};
  const maps = build_batch_maps();
  const v2 = options.v2_candidates || read_json(FILE_AI_CANDIDATES_V2);
  const v2_review = options.v2_review || read_json(FILE_AI_REVIEW_V2);
  const phase_c = options.phase_e_candidates || read_json(FILE_PHASE_E_CANDIDATES_IMPORTED);
  const phase_review = options.phase_e_review || read_json(FILE_PHASE_E_REVIEW);
  const overrides = options.overrides_doc || load_manual_overrides();
  const g3_f_registry =
    options.g3_f_registry_doc !== undefined
      ? options.g3_f_registry_doc
      : load_g3_f_adopt_registry();
  const g3_f_by_id = g3_f_registry.adoptions_by_track_id || {};

  const tracks = index_doc.tracks_by_id || {};
  const ids = Object.keys(tracks).sort();
  const states_by_track_id = {};
  const tier_counts = { high: 0, medium: 0, low: 0 };
  const tier_counts_phase_e = { high: 0, medium: 0, low: 0 };
  const formal_counts = {
    confirmed: 0,
    ai_suggested: 0,
    unknown: 0,
    rejected: 0,
  };

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const row = tracks[id];
    const batch_id = resolve_track_batch(id, maps);
    const in_sample = batch_id !== null;

    let candidate = null;
    let batch_review = null;
    if (batch_id === TEST_BATCH_V2_30) {
      candidate = v2 ? find_candidate(v2, id) : null;
      batch_review =
        v2_review && v2_review.reviews_by_track_id
          ? v2_review.reviews_by_track_id[id]
          : null;
    } else if (batch_id === TEST_BATCH_PHASE_E_100) {
      candidate = phase_c ? find_candidate(phase_c, id) : null;
      batch_review =
        phase_review && phase_review.reviews_by_track_id
          ? phase_review.reviews_by_track_id[id]
          : null;
    }

    const tier_result =
      in_sample && candidate
        ? compute_confidence_tier({ candidate, index_row: row })
        : { tier: 'low', reasons: ['非 AI 樣本或無候選'] };

    const g3_f_entry = g3_f_by_id[id] || null;
    const formal = resolve_formal_classification_state({
      override_row: overrides.overrides_by_track_id[id] || null,
      g3_f_registry_row: g3_f_entry,
      batch_review,
      batch_candidate: candidate,
      v2_review: batch_review,
      v2_candidate: candidate,
      in_ai_sample: in_sample,
      index_genre_profile: row.genre_profile,
      index_tags: row.tags,
    });

    formal_counts[formal] = (formal_counts[formal] || 0) + 1;
    if (in_sample && candidate) {
      if (batch_id === TEST_BATCH_PHASE_E_100) {
        tier_counts_phase_e[tier_result.tier] =
          (tier_counts_phase_e[tier_result.tier] || 0) + 1;
      } else {
        tier_counts[tier_result.tier] = (tier_counts[tier_result.tier] || 0) + 1;
      }
    }

    states_by_track_id[id] = {
      formal_state: formal,
      confidence_tier: tier_result.tier,
      confidence_reasons: tier_result.reasons,
      ai_sample: in_sample,
      test_batch_id: batch_id,
      candidate_version: in_sample && candidate ? AI_CANDIDATE_VERSION_V2 : null,
    };
  }

  const doc = {
    schema_version: FORMAL_CLASSIFICATION_STATE_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    candidate_version: AI_CANDIDATE_VERSION_V2,
    sample_id: maps.v2_sample ? maps.v2_sample.sample_id : null,
    phase_e_sample_id: maps.phase_sample ? maps.phase_sample.sample_id : null,
    track_count: ids.length,
    sample_tier_counts: tier_counts,
    phase_e_sample_tier_counts: tier_counts_phase_e,
    formal_state_counts: formal_counts,
    states_by_track_id,
  };

  if (options.write !== false) {
    if (!fs.existsSync(CLASSIFICATION_DIR)) {
      fs.mkdirSync(CLASSIFICATION_DIR, { recursive: true });
    }
    write_json_atomic(FILE_FORMAL_CLASSIFICATION_STATE, doc);
  }

  return doc;
}
