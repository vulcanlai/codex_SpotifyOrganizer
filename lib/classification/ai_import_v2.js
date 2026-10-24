/**
 * AI v2 候選匯入（獨立於 v1，不覆寫根目錄 v1 檔）
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  AI_TEST_V2_DIR,
  FILE_AI_SAMPLE,
  FILE_AI_CANDIDATES,
  FILE_AI_CANDIDATES_V2_DRAFT,
  FILE_AI_CANDIDATES_V2,
  FILE_AI_REVIEW_V2,
  FILE_AI_COMPARE_SUMMARY,
  AI_CANDIDATE_VERSION_V2,
} from './paths.js';
import { write_json_atomic } from '../atomic_json.js';
import {
  validate_ai_candidates_v2_doc,
  normalize_ai_candidates_v2_doc,
  AiCandidatesValidationError,
} from './ai_validate.js';
import {
  load_ai_review_at,
  save_ai_review_at,
  empty_review_doc,
  REVIEW_PENDING,
} from './ai_review_store.js';
import { compare_ai_candidate_docs } from './ai_compare.js';
import { archive_ai_v1_records } from './ai_archive_v1.js';

export class AiImportV2Error extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiImportV2Error';
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
export function import_ai_candidates_v2(opts) {
  const options = opts || {};
  archive_ai_v1_records();

  const sample_doc = options.sample_doc || read_json(FILE_AI_SAMPLE);
  if (!sample_doc) {
    throw new AiImportV2Error('缺少 sample-30.json，請先執行 classify:ai-export。');
  }

  const draft_path = options.draft_path || FILE_AI_CANDIDATES_V2_DRAFT;
  const draft_doc = options.candidates_doc || read_json(draft_path);
  if (!draft_doc) {
    throw new AiImportV2Error('缺少 ai-test/v2/ai-candidates.json。');
  }

  let normalized;
  try {
    normalized = normalize_ai_candidates_v2_doc(draft_doc);
    validate_ai_candidates_v2_doc(normalized, sample_doc);
  } catch (err) {
    if (err instanceof AiCandidatesValidationError) {
      throw new AiImportV2Error(err.message);
    }
    throw err;
  }

  const imported_at = new Date().toISOString();
  const fingerprint = candidates_fingerprint(normalized);

  const existing = read_json(FILE_AI_CANDIDATES_V2);
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
      compare_summary: read_json(FILE_AI_COMPARE_SUMMARY),
    };
  }

  const out_doc = {
    schema_version: normalized.schema_version,
    candidate_version: AI_CANDIDATE_VERSION_V2,
    source: normalized.source || 'cursor_ai',
    taxonomy_version: normalized.taxonomy_version || 1,
    sample_size: sample_doc.track_count,
    sample_id: sample_doc.sample_id,
    imported_at,
    content_fingerprint: fingerprint,
    candidates: normalized.candidates,
  };

  if (options.write !== false) {
    fs.mkdirSync(AI_TEST_V2_DIR, { recursive: true });
    write_json_atomic(FILE_AI_CANDIDATES_V2, out_doc);

    const v1_doc = read_json(FILE_AI_CANDIDATES);
    const compare = compare_ai_candidate_docs(
      v1_doc,
      out_doc,
      sample_doc.track_ids
    );
    write_json_atomic(FILE_AI_COMPARE_SUMMARY, {
      generated_at: imported_at,
      sample_id: sample_doc.sample_id,
      ...compare,
    });

    let review = load_ai_review_at(FILE_AI_REVIEW_V2);
    if (review.sample_id !== sample_doc.sample_id) {
      review = empty_review_doc(sample_doc.sample_id);
    }
    review.candidate_version = AI_CANDIDATE_VERSION_V2;
    review.sample_id = sample_doc.sample_id;
    review.candidates_imported_at = imported_at;
    review.reviews_by_track_id = {};
    for (let i = 0; i < out_doc.candidates.length; i += 1) {
      const id = out_doc.candidates[i].spotify_id;
      review.reviews_by_track_id[id] = {
        status: REVIEW_PENDING,
        updated_at: imported_at,
        source: null,
        label: 'v2_pending',
      };
    }
    save_ai_review_at(FILE_AI_REVIEW_V2, review);
  }

  const v1_for_compare = read_json(FILE_AI_CANDIDATES);
  const compare_summary = compare_ai_candidate_docs(
    v1_for_compare,
    out_doc,
    sample_doc.track_ids
  );

  return {
    imported: true,
    idempotent: false,
    candidates_doc: out_doc,
    sample_doc,
    compare_summary,
  };
}
