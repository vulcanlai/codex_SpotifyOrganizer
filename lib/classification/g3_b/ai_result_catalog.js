/**
 * 盤點多來源 AI 分類建議（唯讀）
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { GENRE_TAXONOMY_VERSION } from '../paths.js';
import { genre_profile_from_ai_candidate } from '../genre_profile.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import { load_g3_source_bundle } from '../g3_evidence/source_loaders.js';
import { FILE_G3_B1_AI_DRAFT_READONLY } from './paths_b2.js';
import { resolve_human_confirmation } from '../g3_evidence/human_confirmation.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function sha16(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * @param {object} evidence_fingerprints from evidence-index
 */
export function build_evidence_fingerprint(evidence_fingerprints) {
  const parts = evidence_fingerprints || {};
  return sha16(JSON.stringify(parts) + ':taxonomy:' + GENRE_TAXONOMY_VERSION);
}

function language_from_candidate(c) {
  if (!c) {
    return null;
  }
  const lang = c.language;
  if (!lang) {
    return null;
  }
  if (typeof lang === 'string') {
    return { value: lang, confidence: 'inferred' };
  }
  return {
    value: lang.value,
    confidence: lang.confidence || 'inferred',
    evidence: lang.evidence,
  };
}

function record_from_g3b1_row(row, meta) {
  const gp = row.genre_profile || {};
  return {
    track_id: row.track_id,
    source: 'g3_b1_ai_draft',
    model_or_runner: meta.source || 'cursor_agent_g3_b1',
    taxonomy_version: GENRE_TAXONOMY_VERSION,
    evidence_fingerprint: meta.evidence_fingerprint,
    generated_at: meta.imported_at || null,
    primary_genre: gp.primary_genre || GENRE_PRIMARY_UNKNOWN,
    subgenres: gp.subgenres || [],
    secondary_genres: gp.secondary_genres || [],
    language: row.language || null,
    contexts: row.contexts || [],
    special_types: row.special_types || [],
    confidence_tier: row.confidence_tier || null,
    confidence: row.confidence || 'inferred',
    review_status: meta.review_status || null,
    reusable: meta.reusable !== false,
    regen_required: false,
    regen_reason: null,
  };
}

function record_from_v2(spotify_id, entry, evidence_fingerprint) {
  const c = entry.candidate;
  const gp = genre_profile_from_ai_candidate(c);
  return {
    track_id: spotify_id,
    source: entry.batch_id || 'v2-30',
    model_or_runner: 'cursor_ai_v2_candidates',
    taxonomy_version: GENRE_TAXONOMY_VERSION,
    evidence_fingerprint: evidence_fingerprint,
    generated_at: c.generated_at || null,
    primary_genre: gp.primary_genre,
    subgenres: gp.subgenres || [],
    secondary_genres: gp.secondary_genres || [],
    language: language_from_candidate(c),
    contexts: c.contexts || c.moods || [],
    special_types: c.special_types || [],
    confidence_tier: null,
    confidence: 'inferred',
    review_status: null,
    reusable: true,
    regen_required: false,
    regen_reason: null,
  };
}

/**
 * @param {string} track_id
 * @param {object} ctx
 */
export function collect_ai_result_records_for_track(track_id, ctx) {
  const options = ctx || {};
  const bundle = options.bundle || load_g3_source_bundle();
  const evidence_fp = options.evidence_fingerprint || 'unknown';
  /** @type {object[]} */
  const records = [];

  const g3b1 = options.g3b1_by_id || {};
  if (g3b1[track_id]) {
    const review = options.auto_review_by_id && options.auto_review_by_id[track_id];
    records.push(
      record_from_g3b1_row(g3b1[track_id], {
        imported_at: options.g3b1_imported_at,
        source: options.g3b1_source,
        evidence_fingerprint: evidence_fp,
        review_status: review ? review.status : null,
        reusable: true,
      })
    );
  }

  const cand = bundle.ai_candidate_by_id[track_id];
  if (cand) {
    records.push(record_from_v2(track_id, cand, evidence_fp));
  }

  const index_row = bundle.index.tracks_by_id[track_id];
  const human = resolve_human_confirmation(track_id, {
    index_row: index_row,
    overrides_doc: bundle.manual_overrides,
    v2_review: bundle.ai_review_by_id[track_id]
      ? bundle.ai_review_by_id[track_id].review
      : null,
  });

  if (human.locked) {
    for (let i = 0; i < records.length; i += 1) {
      records[i].reusable = false;
      records[i].regen_required = false;
      records[i].note = '人工確認優先；AI 紀錄僅供對照';
    }
  }

  return records;
}

/**
 * @param {string[]} track_ids
 * @param {object} ctx
 */
export function build_ai_result_inventory(track_ids, ctx) {
  const options = ctx || {};
  const g3b1_doc = read_json(FILE_G3_B1_AI_DRAFT_READONLY);
  const g3b1_by_id = {};
  if (g3b1_doc && g3b1_doc.tracks) {
    for (let i = 0; i < g3b1_doc.tracks.length; i += 1) {
      g3b1_by_id[g3b1_doc.tracks[i].track_id] = g3b1_doc.tracks[i];
    }
  }

  const auto_review_by_id = {};
  if (options.auto_review_results) {
    for (let r = 0; r < options.auto_review_results.length; r += 1) {
      auto_review_by_id[options.auto_review_results[r].track_id] =
        options.auto_review_results[r].review;
    }
  }

  const per_track = [];
  let total_raw = 0;

  for (let t = 0; t < track_ids.length; t += 1) {
    const id = track_ids[t];
    const records = collect_ai_result_records_for_track(id, {
      bundle: options.bundle,
      evidence_fingerprint: options.evidence_fingerprint,
      g3b1_by_id: g3b1_by_id,
      g3b1_imported_at: g3b1_doc ? g3b1_doc.imported_at : null,
      g3b1_source: g3b1_doc ? g3b1_doc.source : null,
      auto_review_by_id: auto_review_by_id,
    });
    total_raw += records.length;
    per_track.push({
      track_id: id,
      records: records,
    });
  }

  return { per_track: per_track, total_raw_records: total_raw, g3b1_by_id: g3b1_by_id };
}
