/**
 * G1 查證快取、結果、進度（不寫入 Spotify 備份或分類正式檔）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { G1_SCHEMA_VERSION, VERIFY_STATUS } from './paths.js';
import {
  verify_data_dir,
  file_verify_query_cache,
  file_verify_verification,
  file_verify_progress,
} from './verify_data_dir.js';

function read_json(path) {
  if (!fs.existsSync(path)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function ensure_g1_dir() {
  const dir = verify_data_dir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function empty_query_cache_doc() {
  return {
    schema_version: G1_SCHEMA_VERSION,
    updated_at: null,
    queries: {},
  };
}

export function empty_verification_doc(sample_doc) {
  return {
    schema_version: G1_SCHEMA_VERSION,
    sample_id: sample_doc ? sample_doc.sample_id : null,
    updated_at: null,
    tracks: {},
  };
}

export function empty_progress_doc() {
  return {
    schema_version: G1_SCHEMA_VERSION,
    updated_at: null,
    mode: 'offline',
    completed_ids: [],
    pending_ids: [],
    stats: {
      network_requests: 0,
      cache_hits: 0,
      retries: 0,
      errors: 0,
    },
    last_error: null,
  };
}

export function load_query_cache() {
  const doc = read_json(file_verify_query_cache());
  if (!doc || !doc.queries) {
    return empty_query_cache_doc();
  }
  return doc;
}

export function load_verification_results() {
  const doc = read_json(file_verify_verification());
  if (!doc || !doc.tracks) {
    return empty_verification_doc(null);
  }
  return doc;
}

export function load_progress() {
  const doc = read_json(file_verify_progress());
  if (!doc) {
    return empty_progress_doc();
  }
  return doc;
}

/**
 * @param {object} doc
 */
export function save_query_cache(doc) {
  ensure_g1_dir();
  doc.updated_at = new Date().toISOString();
  write_json_atomic(file_verify_query_cache(), doc);
}

/**
 * @param {object} doc
 */
export function save_verification_results(doc) {
  ensure_g1_dir();
  doc.updated_at = new Date().toISOString();
  write_json_atomic(file_verify_verification(), doc);
}

/**
 * @param {object} doc
 */
export function save_progress(doc) {
  ensure_g1_dir();
  doc.updated_at = new Date().toISOString();
  write_json_atomic(file_verify_progress(), doc);
}

/**
 * @param {object} cache_doc
 * @param {string} query_key
 */
export function get_cached_query(cache_doc, query_key) {
  return cache_doc.queries[query_key] || null;
}

/**
 * @param {object} cache_doc
 * @param {string} query_key
 * @param {object} entry
 */
export function put_cached_query(cache_doc, query_key, entry) {
  cache_doc.queries[query_key] = entry;
}

/**
 * @param {object} ver_doc
 * @param {string} spotify_id
 */
export function get_track_verification(ver_doc, spotify_id) {
  return ver_doc.tracks[spotify_id] || null;
}

/**
 * @param {import('./provider_base.js').ExternalTrackInput} input
 * @param {object} match_meta
 */
export function build_track_result_row(input, match_meta) {
  const now = new Date().toISOString();
  return {
    spotify_id: input.spotify_id,
    source_title: input.title,
    source_artists: input.artists.slice(),
    source_album: input.album_name || null,
    source_isrc: input.isrc || null,
    source_duration_ms: input.duration_ms != null ? input.duration_ms : null,
    provider: match_meta.provider,
    verify_status: match_meta.verify_status,
    version_ambiguous: !!match_meta.version_ambiguous,
    best_match: match_meta.best_match,
    candidates: match_meta.candidates,
    facts: match_meta.facts,
    inference: match_meta.inference,
    unknown: match_meta.unknown,
    verified_at: now,
    query_keys_used: match_meta.query_keys_used || [],
    verify_engine: match_meta.verify_engine || null,
    match_tier: match_meta.match_tier || null,
    match_tier_note: match_meta.match_tier_note || null,
    isrc_conflict: !!match_meta.isrc_conflict,
    fallback_search_used: !!match_meta.fallback_search_used,
    artist_match_status: match_meta.artist_match_status || null,
    artist_evidence_sources: match_meta.artist_evidence_sources || [],
    isrc_conflict_reasons: match_meta.isrc_conflict_reasons || [],
  };
}

export function is_verification_final(row) {
  if (!row || !row.verify_status) {
    return false;
  }
  return row.verify_status !== VERIFY_STATUS.pending;
}
