/**
 * AI 候選人工審核狀態（不直接寫入正式分類）
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CLASSIFICATION_DIR,
  FILE_AI_REVIEW,
  AI_REVIEW_SCHEMA_VERSION,
} from './paths.js';
import { write_json_atomic } from '../atomic_json.js';
import { genre_profile_from_ai_candidate } from './genre_profile.js';

export const REVIEW_PENDING = 'pending';
export const REVIEW_ACCEPTED = 'accepted';
export const REVIEW_REJECTED = 'rejected';
export const REVIEW_MODIFIED = 'modified';

export class AiReviewError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiReviewError';
  }
}

export function empty_review_doc(sample_ref) {
  return {
    schema_version: AI_REVIEW_SCHEMA_VERSION,
    updated_at: null,
    sample_id: sample_ref || null,
    candidates_imported_at: null,
    reviews_by_track_id: {},
  };
}

function parse_review_doc(raw, file_path) {
  const doc = raw;
  if (doc.schema_version !== AI_REVIEW_SCHEMA_VERSION) {
    throw new AiReviewError(`${file_path} schema_version 不符`);
  }
  if (!doc.reviews_by_track_id) {
    doc.reviews_by_track_id = {};
  }
  return doc;
}

export function load_ai_review_at(file_path) {
  if (!fs.existsSync(file_path)) {
    return empty_review_doc();
  }
  const doc = JSON.parse(fs.readFileSync(file_path, 'utf8'));
  return parse_review_doc(doc, file_path);
}

export function save_ai_review_at(file_path, doc) {
  const dir = path.dirname(file_path);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  doc.schema_version = AI_REVIEW_SCHEMA_VERSION;
  doc.updated_at = new Date().toISOString();
  write_json_atomic(file_path, doc);
  return doc;
}

export function load_ai_review() {
  if (!fs.existsSync(FILE_AI_REVIEW)) {
    return empty_review_doc();
  }
  return load_ai_review_at(FILE_AI_REVIEW);
}

export function save_ai_review(doc) {
  if (!fs.existsSync(CLASSIFICATION_DIR)) {
    fs.mkdirSync(CLASSIFICATION_DIR, { recursive: true });
  }
  return save_ai_review_at(FILE_AI_REVIEW, doc);
}

/**
 * @param {object} review_doc
 */
export function count_review_stats(review_doc) {
  const reviews = review_doc.reviews_by_track_id || {};
  const ids = Object.keys(reviews);
  const stats = {
    total: ids.length,
    pending: 0,
    accepted: 0,
    rejected: 0,
    modified: 0,
  };
  for (let i = 0; i < ids.length; i += 1) {
    const st = reviews[ids[i]].status;
    if (st === REVIEW_ACCEPTED) {
      stats.accepted += 1;
    } else if (st === REVIEW_REJECTED) {
      stats.rejected += 1;
    } else if (st === REVIEW_MODIFIED) {
      stats.modified += 1;
    } else {
      stats.pending += 1;
    }
  }
  return stats;
}

/**
 * @param {object} candidate
 */
export function candidate_to_override_patch(candidate) {
  const patch = { source: 'ai_review:accepted' };
  patch.genre_profile = genre_profile_from_ai_candidate(candidate);
  if (candidate.language && candidate.language.value) {
    patch.language = candidate.language.value;
  }
  const genres = candidate.genres || [];
  if (genres.length) {
    patch.genres = genres.map(function (g) {
      return g.value;
    });
  }
  const contexts = candidate.contexts || candidate.moods || [];
  if (contexts.length) {
    patch.contexts = contexts.map(function (c) {
      return c.value;
    });
  }
  const special = candidate.special_types || [];
  if (special.length) {
    patch.special_types = special.map(function (s) {
      return s.value;
    });
  }
  return patch;
}
