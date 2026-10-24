/**
 * G3 證據來源載入（唯讀，不呼叫外部 API）
 */
import fs from 'node:fs';
import path from 'node:path';
import { FILE_CLASSIFICATION_INDEX, FILE_FORMAL_CLASSIFICATION_STATE } from '../paths.js';
import { FILE_TRACK_CACHE } from '../../enrichment/paths.js';
import { G1_TRIAL_DIR } from '../../enrichment/external/g1_path_resolve.js';
import { G2_1_OFFLINE_REPLAY_FILE } from '../../enrichment/external/g2_1_offline_replay.js';
import {
  FILE_AI_CANDIDATES_V2,
  FILE_AI_REVIEW_V2,
  FILE_AI_SAMPLE,
} from '../paths.js';
import {
  FILE_PHASE_E_CANDIDATES_IMPORTED,
  FILE_PHASE_E_REVIEW,
  FILE_PHASE_E_SAMPLE,
} from '../ai_test_batches.js';
import { load_manual_overrides } from '../overrides_store.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function load_g3_source_bundle() {
  const g1_ver_path = path.join(G1_TRIAL_DIR, 'verification-results.json');
  const g2_ver_path = path.join(path.dirname(G1_TRIAL_DIR), 'g2-30', 'verification-results.json');

  const g2_1_replay = read_json(G2_1_OFFLINE_REPLAY_FILE);
  const g2_1_by_id = {};
  if (g2_1_replay && g2_1_replay.per_track) {
    for (let i = 0; i < g2_1_replay.per_track.length; i += 1) {
      const row = g2_1_replay.per_track[i];
      g2_1_by_id[row.spotify_id] = row;
    }
  }

  const v2_candidates = read_json(FILE_AI_CANDIDATES_V2);
  const v2_review = read_json(FILE_AI_REVIEW_V2);
  const phase_candidates = read_json(FILE_PHASE_E_CANDIDATES_IMPORTED);
  const phase_review = read_json(FILE_PHASE_E_REVIEW);

  const ai_candidate_by_id = {};
  const ai_review_by_id = {};

  function index_candidates(doc, batch_id) {
    const list = doc && doc.candidates ? doc.candidates : [];
    for (let i = 0; i < list.length; i += 1) {
      const c = list[i];
      if (!c || !c.spotify_id) {
        continue;
      }
      ai_candidate_by_id[c.spotify_id] = { batch_id: batch_id, candidate: c };
    }
  }

  function index_review(doc, batch_id) {
    const tracks = doc && doc.tracks ? doc.tracks : {};
    const ids = Object.keys(tracks);
    for (let j = 0; j < ids.length; j += 1) {
      const prev = ai_review_by_id[ids[j]];
      if (prev && prev.batch_id === 'v2-30') {
        continue;
      }
      ai_review_by_id[ids[j]] = {
        batch_id: batch_id,
        review: tracks[ids[j]],
      };
    }
  }

  index_candidates(v2_candidates, 'v2-30');
  index_candidates(phase_candidates, 'phase-e-100');
  index_review(v2_review, 'v2-30');
  index_review(phase_review, 'phase-e-100');

  const sample_sets = {
    g1_g2: {},
    v2: {},
    phase_e: {},
  };
  const g1_sample = read_json(path.join(G1_TRIAL_DIR, 'sample-30.json'));
  if (g1_sample && g1_sample.track_ids) {
    for (let s = 0; s < g1_sample.track_ids.length; s += 1) {
      sample_sets.g1_g2[g1_sample.track_ids[s]] = true;
    }
  }
  const v2_sample = read_json(FILE_AI_SAMPLE);
  if (v2_sample && v2_sample.track_ids) {
    for (let v = 0; v < v2_sample.track_ids.length; v += 1) {
      sample_sets.v2[v2_sample.track_ids[v]] = true;
    }
  }
  const pe_sample = read_json(FILE_PHASE_E_SAMPLE);
  if (pe_sample && pe_sample.track_ids) {
    for (let p = 0; p < pe_sample.track_ids.length; p += 1) {
      sample_sets.phase_e[pe_sample.track_ids[p]] = true;
    }
  }

  return {
    index: read_json(FILE_CLASSIFICATION_INDEX),
    formal_state: read_json(FILE_FORMAL_CLASSIFICATION_STATE),
    metadata_cache: read_json(FILE_TRACK_CACHE),
    manual_overrides: load_manual_overrides(),
    g1_verification: read_json(g1_ver_path),
    g2_verification: read_json(g2_ver_path),
    g2_1_by_id: g2_1_by_id,
    g2_1_replay_meta: g2_1_replay
      ? { generated_at: g2_1_replay.generated_at, verify_engine: g2_1_replay.verify_engine }
      : null,
    ai_candidate_by_id: ai_candidate_by_id,
    ai_review_by_id: ai_review_by_id,
    sample_sets: sample_sets,
    source_refs: {
      classification_index: FILE_CLASSIFICATION_INDEX,
      track_metadata_cache: FILE_TRACK_CACHE,
      g1_verification: g1_ver_path,
      g2_verification: g2_ver_path,
      g2_1_offline_replay: G2_1_OFFLINE_REPLAY_FILE,
      formal_classification_state: FILE_FORMAL_CLASSIFICATION_STATE,
    },
  };
}

/**
 * @param {object|null} ver_row
 * @param {string} engine
 * @param {string} source_ref
 */
export function verification_row_to_layer(ver_row, engine, source_ref) {
  if (!ver_row) {
    return null;
  }
  const best = ver_row.best_match || null;
  const artist_status = ver_row.artist_match_status || null;

  let artist_verified = false;
  let pending = false;
  let note = null;

  if (artist_status === 'verified') {
    artist_verified = true;
  } else if (artist_status === 'unverified_cross_script') {
    pending = true;
    note = '藝人名稱跨語系尚未核實；不得視為藝人文字一致';
  } else if (ver_row.verify_status === 'matched' && best && !ver_row.isrc_conflict) {
    artist_verified = true;
  }

  const unreliable =
    ver_row.verify_status === 'ambiguous' ||
    ver_row.verify_status === 'insufficient' ||
    ver_row.verify_status === 'not_found' ||
    ver_row.verify_status === 'error';

  if (unreliable) {
    note = note || '外部錄音未可靠確認；候選不得當確定事實';
    pending = true;
  }

  return {
    engine: engine,
    verify_status: ver_row.verify_status,
    match_tier: ver_row.match_tier || null,
    artist_match_status: artist_status,
    artist_verified: artist_verified,
    isrc_conflict: !!ver_row.isrc_conflict,
    recording_id: best ? best.external_id : null,
    match_score: best ? best.match_score : null,
    is_online_mb: engine === 'g1' || engine === 'g2',
    source_ref: source_ref,
    obtained_at: ver_row.verified_at || null,
    pending_verification: pending,
    note: note,
    fallback_search_used: !!ver_row.fallback_search_used,
    candidate_count: (ver_row.candidates || []).length,
    query_keys_used: (ver_row.query_keys_used || []).slice(),
  };
}

/**
 * G2.1 離線重算層（非線上 MB）
 * @param {object|null} replay_row
 * @param {object|null} g2_row
 */
export function g2_1_layer_from_replay(replay_row, g2_row, source_ref) {
  if (!replay_row && !g2_row) {
    return null;
  }
  const artist_status = replay_row ? replay_row.artist_match_status : g2_row.artist_match_status;
  const status = replay_row ? replay_row.g2_1_offline_status : g2_row.verify_status;
  const tier = replay_row ? replay_row.g2_1_match_tier : g2_row.match_tier;
  const recording = replay_row
    ? replay_row.mb_recording_id
    : g2_row.best_match
      ? g2_row.best_match.external_id
      : null;
  const score = replay_row
    ? replay_row.match_score
    : g2_row.best_match
      ? g2_row.best_match.match_score
      : null;

  let note = 'G2.1 離線重算（非 MusicBrainz 線上查詢）';
  let pending = true;
  let artist_verified = false;

  if (artist_status === 'unverified_cross_script') {
    note += '；藝人跨語系尚未核實';
  } else if (artist_status === 'verified') {
    artist_verified = true;
    pending = false;
  }

  if (
    status === 'ambiguous' ||
    status === 'insufficient' ||
    status === 'not_found'
  ) {
    pending = true;
    note += '；錄音未達可靠 matched';
  } else if (status === 'matched' && artist_status !== 'unverified_cross_script') {
    pending = false;
  }

  return {
    engine: 'g2.1-offline',
    verify_status: status,
    match_tier: tier,
    artist_match_status: artist_status || null,
    artist_verified: artist_verified,
    isrc_conflict: replay_row ? !!replay_row.isrc_conflict : !!g2_row.isrc_conflict,
    recording_id: recording,
    match_score: score,
    is_online_mb: false,
    source_ref: source_ref,
    obtained_at: null,
    pending_verification: pending,
    note: note,
    improvement_kind: replay_row ? replay_row.improvement_kind : null,
  };
}
