/**
 * AI 候選匯入（驗證通過後寫入 ai-candidates.json）
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  CLASSIFICATION_DIR,
  FILE_AI_SAMPLE,
  FILE_AI_CANDIDATES_DRAFT,
  FILE_AI_CANDIDATES,
} from './paths.js';
import { write_json_atomic } from '../atomic_json.js';
import {
  validate_ai_candidates_doc,
  normalize_ai_candidates_doc,
  AiCandidatesValidationError,
} from './ai_validate.js';
import {
  load_ai_review,
  save_ai_review,
  empty_review_doc,
} from './ai_review_store.js';

export class AiImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiImportError';
  }
}

function read_json(path) {
  if (!fs.existsSync(path)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function candidates_fingerprint(doc) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(doc.candidates))
    .digest('hex');
}

/**
 * @param {object} [opts]
 */
export function import_ai_candidates(opts) {
  const options = opts || {};
  const sample_doc = options.sample_doc || read_json(FILE_AI_SAMPLE);
  if (!sample_doc) {
    throw new AiImportError('缺少 sample-30.json，請先執行 classify:ai-export。');
  }

  const draft_path = options.draft_path || FILE_AI_CANDIDATES_DRAFT;
  const draft_doc = options.candidates_doc || read_json(draft_path);
  if (!draft_doc) {
    throw new AiImportError('缺少 ai-test/ai-candidates.json。');
  }

  let normalized;
  try {
    normalized = normalize_ai_candidates_doc(draft_doc);
    validate_ai_candidates_doc(normalized, sample_doc);
  } catch (err) {
    if (err instanceof AiCandidatesValidationError) {
      throw new AiImportError(err.message);
    }
    throw err;
  }

  const imported_at = new Date().toISOString();
  const fingerprint = candidates_fingerprint(normalized);

  const existing = read_json(FILE_AI_CANDIDATES);
  if (
    existing &&
    existing.content_fingerprint === fingerprint &&
    existing.sample_id === sample_doc.sample_id
  ) {
    return {
      imported: false,
      idempotent: true,
      candidates_doc: existing,
      sample_doc,
    };
  }

  const out_doc = {
    schema_version: normalized.schema_version,
    source: normalized.source || 'cursor_ai',
    sample_size: sample_doc.track_count,
    sample_id: sample_doc.sample_id,
    imported_at,
    content_fingerprint: fingerprint,
    candidates: normalized.candidates,
  };

  if (options.write !== false) {
    if (!fs.existsSync(CLASSIFICATION_DIR)) {
      fs.mkdirSync(CLASSIFICATION_DIR, { recursive: true });
    }
    write_json_atomic(FILE_AI_CANDIDATES, out_doc);

    let review = load_ai_review();
    if (review.sample_id !== sample_doc.sample_id) {
      review = empty_review_doc(sample_doc.sample_id);
    }
    review.sample_id = sample_doc.sample_id;
    review.candidates_imported_at = imported_at;
    for (let i = 0; i < out_doc.candidates.length; i += 1) {
      const id = out_doc.candidates[i].spotify_id;
      if (!review.reviews_by_track_id[id]) {
        review.reviews_by_track_id[id] = {
          status: 'pending',
          updated_at: imported_at,
          source: null,
        };
      }
    }
    save_ai_review(review);
  }

  return {
    imported: true,
    idempotent: false,
    candidates_doc: out_doc,
    sample_doc,
  };
}
