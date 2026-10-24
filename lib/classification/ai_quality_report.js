/**
 * AI 分類品質報告（phase-e-100 及可擴充批次）
 */
import fs from 'node:fs';
import {
  FILE_CLASSIFICATION_INDEX,
  FILE_AI_SAMPLE,
} from './paths.js';
import { write_json_atomic } from '../atomic_json.js';
import {
  get_test_batch_config,
  TEST_BATCH_PHASE_E_100,
  FILE_PHASE_E_QUALITY_REPORT,
  FILE_PHASE_E_SAMPLE,
} from './ai_test_batches.js';
import { compute_confidence_tier } from './confidence_tier.js';
import {
  genre_profile_from_ai_candidate,
  filter_valid_subgenres,
} from './genre_profile.js';
import {
  GENRE_PRIMARY_UNKNOWN,
  SUBGENRES_BY_CODE,
} from './genre_taxonomy.js';
import {
  REVIEW_ACCEPTED,
  REVIEW_MODIFIED,
  REVIEW_REJECTED,
  REVIEW_PENDING,
} from './ai_review_store.js';
import {
  primary_artist_name,
  decade_from_tags,
} from './ai_sample_select.js';

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

function inc(map, key) {
  const k = key || 'unknown';
  map[k] = (map[k] || 0) + 1;
}

function primary_unknown_count(candidate) {
  const gp = genre_profile_from_ai_candidate(candidate);
  return gp.primary_genre === GENRE_PRIMARY_UNKNOWN ? 1 : 0;
}

function subgenre_mismatch(candidate) {
  const gp = genre_profile_from_ai_candidate(candidate);
  if (gp.primary_genre === GENRE_PRIMARY_UNKNOWN) {
    return 0;
  }
  const subs = gp.subgenres || [];
  const valid = filter_valid_subgenres(
    subs,
    gp.primary_genre,
    gp.secondary_genres || []
  );
  return valid.length !== subs.length ? 1 : 0;
}

function weak_evidence(candidate) {
  const prim =
    candidate.genre_profile && candidate.genre_profile.primary_genre
      ? candidate.genre_profile.primary_genre
      : null;
  if (!prim || !prim.evidence || prim.evidence.trim().length < 12) {
    return 1;
  }
  return 0;
}

/**
 * @param {object} [opts]
 */
export function build_phase_e_quality_report(opts) {
  const options = opts || {};
  const batch_id = options.test_batch_id || TEST_BATCH_PHASE_E_100;
  const cfg = get_test_batch_config(batch_id);
  const sample =
    options.sample_doc ||
    read_json(cfg.sample_file) ||
    read_json(FILE_PHASE_E_SAMPLE);
  const imported = read_json(cfg.candidates_imported_file);
  const review = read_json(cfg.review_file);
  const index = read_json(FILE_CLASSIFICATION_INDEX);
  const tracks_by_id = (index && index.tracks_by_id) || {};

  const track_ids = sample && sample.track_ids ? sample.track_ids : [];
  const primary_dist = {};
  const subgenre_dist = {};
  const tier_dist = { high: 0, medium: 0, low: 0 };
  let unknown_primary = 0;
  let weak_evidence_n = 0;
  let subgenre_mismatch_n = 0;
  let pop_count = 0;
  let completed = 0;
  const decades = {};
  const artists = {};

  let human_confirmed = 0;
  let human_unreviewed = 0;
  let ai_vs_human_diff = 0;

  for (let i = 0; i < track_ids.length; i += 1) {
    const id = track_ids[i];
    const row = tracks_by_id[id] || null;
    if (row) {
      inc(decades, decade_from_tags(row));
      inc(artists, primary_artist_name(row));
    }
    const cand = find_candidate(imported, id);
    if (!cand) {
      continue;
    }
    completed += 1;
    const gp = genre_profile_from_ai_candidate(cand);
    inc(primary_dist, gp.primary_genre);
    if (gp.primary_genre === 'pop') {
      pop_count += 1;
    }
    unknown_primary += primary_unknown_count(cand);
    subgenre_mismatch_n += subgenre_mismatch(cand);
    weak_evidence_n += weak_evidence(cand);
    const subs = gp.subgenres || [];
    for (let s = 0; s < subs.length; s += 1) {
      inc(subgenre_dist, subs[s]);
    }
    const tier = compute_confidence_tier({
      candidate: cand,
      index_row: row,
    });
    tier_dist[tier.tier] = (tier_dist[tier.tier] || 0) + 1;

    const rev =
      review && review.reviews_by_track_id && review.reviews_by_track_id[id]
        ? review.reviews_by_track_id[id].status
        : REVIEW_PENDING;
    if (
      rev === REVIEW_ACCEPTED ||
      rev === REVIEW_MODIFIED ||
      rev === REVIEW_REJECTED
    ) {
      human_confirmed += 1;
    } else {
      human_unreviewed += 1;
    }
    if (
      (rev === REVIEW_ACCEPTED || rev === REVIEW_MODIFIED) &&
      row &&
      row.genre_profile &&
      row.genre_profile.primary_genre &&
      row.genre_profile.primary_genre !== gp.primary_genre
    ) {
      ai_vs_human_diff += 1;
    }
  }

  const primary_values = Object.values(primary_dist);
  let max_primary = 0;
  for (let p = 0; p < primary_values.length; p += 1) {
    if (primary_values[p] > max_primary) {
      max_primary = primary_values[p];
    }
  }
  const concentration =
    completed > 0 ? Math.round((max_primary / completed) * 1000) / 10 : 0;

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    test_batch_id: batch_id,
    sample_id: sample ? sample.sample_id : null,
    sample_track_count: track_ids.length,
    classification_status: {
      ai_completed: completed,
      ai_pending: Math.max(0, track_ids.length - completed),
      human_reviewed: human_confirmed,
      human_unreviewed: human_unreviewed,
    },
    primary_genre_distribution: primary_dist,
    subgenre_distribution: subgenre_dist,
    unknown_primary_count: unknown_primary,
    confidence_tier_distribution: tier_dist,
    primary_genre_concentration_pct: concentration,
    weak_evidence_count: weak_evidence_n,
    subgenre_mismatch_count: subgenre_mismatch_n,
    pop_share_pct:
      completed > 0 ? Math.round((pop_count / completed) * 1000) / 10 : 0,
    pop_count_note:
      '流行佔比高不一定代表分類錯誤，需人工抽樣檢視',
    ai_vs_human_primary_diff: ai_vs_human_diff,
    accuracy_note: '無人工標準答案時不計算 AI 準確率百分比',
    sample_decade_distribution: decades,
    sample_artist_count: Object.keys(artists).length,
    illegal_classification_count: 0,
  };

  if (options.write !== false && batch_id === TEST_BATCH_PHASE_E_100) {
    write_json_atomic(FILE_PHASE_E_QUALITY_REPORT, report);
  }
  return report;
}

export function load_phase_e_quality_report() {
  return read_json(FILE_PHASE_E_QUALITY_REPORT);
}
