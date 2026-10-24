/**
 * phase-e-100 候選合併與匯入
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  normalize_ai_candidates_v2_doc,
  validate_ai_candidates_v2_doc,
  AiCandidatesValidationError,
} from './ai_validate.js';
import { write_json_atomic } from '../atomic_json.js';
import {
  PHASE_E_DIR,
  FILE_PHASE_E_SAMPLE,
  FILE_PHASE_E_CANDIDATES_IMPORTED,
  FILE_PHASE_E_CANDIDATES_DRAFT,
  FILE_PHASE_E_REVIEW,
  FILE_PHASE_E_CURSOR_PROGRESS,
  FILE_PHASE_E_QUALITY_REPORT,
  PHASE_E_PARTIAL_CANDIDATES_DIR,
  TEST_BATCH_PHASE_E_100,
} from './ai_test_batches.js';
import {
  load_ai_review_at,
  save_ai_review_at,
  empty_review_doc,
  REVIEW_PENDING,
} from './ai_review_store.js';
import { build_phase_e_quality_report } from './ai_quality_report.js';

export class PhaseEImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PhaseEImportError';
  }
}

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function candidates_fingerprint(candidates) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(candidates))
    .digest('hex');
}

/**
 * 合併 partial-candidates/*.json
 */
export function merge_phase_e_partial_candidates(opts) {
  const options = opts || {};
  const sample = options.sample_doc || read_json(FILE_PHASE_E_SAMPLE);
  if (!sample) {
    throw new PhaseEImportError('缺少 phase-e sample-100.json，請先 classify:ai-export-phase-e');
  }
  const sample_set = {};
  for (let i = 0; i < sample.track_ids.length; i += 1) {
    sample_set[sample.track_ids[i]] = true;
  }

  const merged = [];
  const seen = {};
  const sources = [];

  if (fs.existsSync(PHASE_E_PARTIAL_CANDIDATES_DIR)) {
    const names = fs.readdirSync(PHASE_E_PARTIAL_CANDIDATES_DIR).sort();
    for (let n = 0; n < names.length; n += 1) {
      if (names[n].indexOf('.json') < 0) {
        continue;
      }
      const doc = JSON.parse(
        fs.readFileSync(PHASE_E_PARTIAL_CANDIDATES_DIR + '/' + names[n], 'utf8')
      );
      sources.push(names[n]);
      const list = doc.candidates || [];
      for (let c = 0; c < list.length; c += 1) {
        const id = list[c].spotify_id;
        if (!sample_set[id]) {
          throw new PhaseEImportError('partial 含非樣本 ID：' + id);
        }
        if (seen[id]) {
          continue;
        }
        seen[id] = true;
        merged.push(list[c]);
      }
    }
  }

  const draft = {
    schema_version: 2,
    candidate_version: 2,
    source: 'cursor_ai',
    test_batch_id: TEST_BATCH_PHASE_E_100,
    sample_id: sample.sample_id,
    taxonomy_version: 1,
    merged_from: sources,
    candidates: merged,
  };

  const normalized = normalize_ai_candidates_v2_doc(draft);
  if (options.write !== false) {
    fs.mkdirSync(PHASE_E_DIR, { recursive: true });
    write_json_atomic(FILE_PHASE_E_CANDIDATES_DRAFT, normalized);
  }
  return { draft: normalized, merged_count: merged.length, sources };
}

/**
 * @param {object} opts
 */
export function import_phase_e_candidates(opts) {
  const options = opts || {};
  const sample = options.sample_doc || read_json(FILE_PHASE_E_SAMPLE);
  if (!sample) {
    throw new PhaseEImportError('缺少 sample-100.json');
  }

  let draft =
    options.candidates_doc ||
    read_json(FILE_PHASE_E_CANDIDATES_DRAFT) ||
    merge_phase_e_partial_candidates({ write: true }).draft;

  let normalized;
  try {
    normalized = normalize_ai_candidates_v2_doc(draft);
    const allow_partial =
      normalized.candidates.length < sample.track_count;
    validate_ai_candidates_v2_doc(normalized, sample, {
      allow_partial,
    });
  } catch (err) {
    if (err instanceof AiCandidatesValidationError) {
      throw new PhaseEImportError(err.message);
    }
    throw err;
  }

  const fingerprint = candidates_fingerprint(normalized.candidates);
  const existing = read_json(FILE_PHASE_E_CANDIDATES_IMPORTED);
  if (
    existing &&
    existing.content_fingerprint === fingerprint &&
    existing.sample_id === sample.sample_id
  ) {
    return {
      imported: false,
      idempotent: true,
      candidates_doc: existing,
    };
  }

  const imported_at = new Date().toISOString();
  const out_doc = Object.assign({}, normalized, {
    imported_at,
    content_fingerprint: fingerprint,
    test_batch_id: TEST_BATCH_PHASE_E_100,
    sample_size: sample.track_count,
  });

  if (options.write !== false) {
    fs.mkdirSync(PHASE_E_DIR, { recursive: true });
    write_json_atomic(FILE_PHASE_E_CANDIDATES_IMPORTED, out_doc);

    let review = load_ai_review_at(FILE_PHASE_E_REVIEW);
    if (review.sample_id !== sample.sample_id) {
      review = empty_review_doc(sample.sample_id);
    }
    review.test_batch_id = TEST_BATCH_PHASE_E_100;
    review.candidates_imported_at = imported_at;

    for (let i = 0; i < normalized.candidates.length; i += 1) {
      const id = normalized.candidates[i].spotify_id;
      if (!review.reviews_by_track_id[id]) {
        review.reviews_by_track_id[id] = {
          status: REVIEW_PENDING,
          updated_at: imported_at,
          source: null,
          label: 'phase_e_pending',
          test_batch_id: TEST_BATCH_PHASE_E_100,
          candidate_version: 2,
        };
      }
    }
    save_ai_review_at(FILE_PHASE_E_REVIEW, review);

    const completed = normalized.candidates.map(function (c) {
      return c.spotify_id;
    });
    const pending = sample.track_ids.filter(function (id) {
      return completed.indexOf(id) < 0;
    });
    write_json_atomic(FILE_PHASE_E_CURSOR_PROGRESS, {
      schema_version: 1,
      test_batch_id: TEST_BATCH_PHASE_E_100,
      updated_at: imported_at,
      sample_id: sample.sample_id,
      total_tracks: sample.track_count,
      ai_completed_track_ids: completed,
      ai_pending_track_ids: pending,
    });

    build_phase_e_quality_report({ write: true });
  }

  return {
    imported: true,
    idempotent: false,
    candidates_doc: out_doc,
    candidate_count: normalized.candidates.length,
  };
}
