/**
 * G3-A 證據索引重建（離線）
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { write_json_atomic } from '../../atomic_json.js';
import {
  g3_evidence_dir,
  file_g3_evidence_index,
  file_g3_coverage_summary,
  file_g3_conflicts_report,
  G3_EVIDENCE_SCHEMA_VERSION,
} from './paths.js';
import { load_g3_source_bundle } from './source_loaders.js';
import { build_track_evidence_doc } from './build_track_evidence.js';
import { count_human_confirmation_stats } from './human_confirmation.js';

function sha_file(path) {
  if (!fs.existsSync(path)) {
    return null;
  }
  const buf = fs.readFileSync(path);
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function build_g3_evidence_index(opts) {
  const options = opts || {};
  const bundle = options.bundle || load_g3_source_bundle();
  if (!bundle.index || !bundle.index.tracks_by_id) {
    throw new Error('缺少 classification-index.json');
  }

  let ids = Object.keys(bundle.index.tracks_by_id).sort();
  if (typeof options.limit_tracks === 'number' && options.limit_tracks > 0) {
    ids = ids.slice(0, options.limit_tracks);
  }
  /** @type {Record<string, object>} */
  const tracks = {};
  /** @type {object[]} */
  const all_conflicts = [];

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const doc = build_track_evidence_doc(id, bundle);
    if (doc) {
      tracks[id] = doc;
      if (doc.conflicts && doc.conflicts.length) {
        for (let c = 0; c < doc.conflicts.length; c += 1) {
          all_conflicts.push({
            track_id: id,
            title: doc.identity.title,
            conflict: doc.conflicts[c],
          });
        }
      }
    }
  }

  const human_stats = count_human_confirmation_stats(bundle.index, bundle);
  const coverage = compute_coverage(tracks, ids.length, human_stats);
  const generated_at = new Date().toISOString();

  const index_doc = {
    schema_version: G3_EVIDENCE_SCHEMA_VERSION,
    generated_at: generated_at,
    track_count: ids.length,
    source_fingerprints: {
      classification_index: sha_file(bundle.source_refs.classification_index),
      track_metadata_cache: sha_file(bundle.source_refs.track_metadata_cache),
      g1_verification: sha_file(bundle.source_refs.g1_verification),
      g2_verification: sha_file(bundle.source_refs.g2_verification),
      g2_1_offline_replay: sha_file(bundle.source_refs.g2_1_offline_replay),
    },
    coverage_summary: coverage,
    tracks: tracks,
  };

  const coverage_doc = {
    schema_version: G3_EVIDENCE_SCHEMA_VERSION,
    generated_at: generated_at,
    track_count: ids.length,
    coverage: coverage,
  };

  const conflicts_doc = {
    schema_version: G3_EVIDENCE_SCHEMA_VERSION,
    generated_at: generated_at,
    conflict_count: all_conflicts.length,
    conflicts: all_conflicts,
  };

  if (options.write !== false) {
    const out_dir = g3_evidence_dir();
    if (!fs.existsSync(out_dir)) {
      fs.mkdirSync(out_dir, { recursive: true });
    }
    write_json_atomic(file_g3_evidence_index(), index_doc);
    write_json_atomic(file_g3_coverage_summary(), coverage_doc);
    write_json_atomic(file_g3_conflicts_report(), conflicts_doc);
  }

  return {
    index_doc: index_doc,
    coverage_doc: coverage_doc,
    conflicts_doc: conflicts_doc,
  };
}

function compute_coverage(tracks, total, human_stats) {
  let with_cache = 0;
  let with_isrc = 0;
  let mb_sample = 0;
  let g2_matched = 0;
  let g2_1_matched = 0;
  let unverified_artist = 0;
  let ai_candidate = 0;
  let human_locked = 0;
  let formal_confirmed = 0;
  let missing_mb = 0;

  const ids = Object.keys(tracks);
  for (let i = 0; i < ids.length; i += 1) {
    const doc = tracks[ids[i]];
    if (doc.identity.enrichment_cache_complete) {
      with_cache += 1;
    }
    if (doc.identity.isrc) {
      with_isrc += 1;
    }
    if (doc.verification_status.in_musicbrainz_sample) {
      mb_sample += 1;
    } else {
      missing_mb += 1;
    }
    if (doc.verification_status.g2 && doc.verification_status.g2.verify_status === 'matched') {
      g2_matched += 1;
    }
    if (
      doc.verification_status.g2_1_offline &&
      doc.verification_status.g2_1_offline.verify_status === 'matched'
    ) {
      g2_1_matched += 1;
    }
    if (
      doc.verification_status.g2_1_offline &&
      doc.verification_status.g2_1_offline.artist_match_status === 'unverified_cross_script'
    ) {
      unverified_artist += 1;
    }
    if (doc.classification_candidates.length) {
      ai_candidate += 1;
    }
    if (doc.human_confirmation && doc.human_confirmation.locked) {
      human_locked += 1;
    }
    const formal = doc.evidence.find(function (e) {
      return e.field === 'formal_classification_state';
    });
    if (formal && formal.value === 'confirmed') {
      formal_confirmed += 1;
    }
  }

  return {
    total_tracks: total,
    enrichment_cache_complete: with_cache,
    with_isrc: with_isrc,
    musicbrainz_sample_30: mb_sample,
    outside_mb_sample: missing_mb,
    g2_matched_in_sample: g2_matched,
    g2_1_offline_matched_in_sample: g2_1_matched,
    g2_1_unverified_cross_script_artist: unverified_artist,
    tracks_with_ai_candidate: ai_candidate,
    human_locked_tracks: human_locked,
    formal_confirmed: formal_confirmed,
    human_confirmation_stats: human_stats || {},
  };
}

/**
 * @param {string} track_id
 */
export function get_track_evidence_from_index(track_id) {
  const p = file_g3_evidence_index();
  if (!fs.existsSync(p)) {
    return null;
  }
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  return doc.tracks && doc.tracks[track_id] ? doc.tracks[track_id] : null;
}
