/**
 * AI 測試批次註冊（v2 30 首 vs phase-e-100，互不重疊）
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  AI_TEST_DIR,
  FILE_AI_SAMPLE,
  FILE_AI_CANDIDATES_V2,
  FILE_AI_REVIEW_V2,
  FILE_AI_BATCH_OPERATIONS_V2,
  AI_CANDIDATE_VERSION_V2,
} from './paths.js';

export const TEST_BATCH_V2_30 = 'v2-sample-30';
export const TEST_BATCH_PHASE_E_100 = 'phase-e-100';

export const AI_TEST_BATCH_IDS = [TEST_BATCH_V2_30, TEST_BATCH_PHASE_E_100];

export const PHASE_E_DIR = path.join(AI_TEST_DIR, 'phase-e-100');
export const FILE_PHASE_E_SAMPLE = path.join(PHASE_E_DIR, 'sample-100.json');
export const FILE_PHASE_E_SAMPLE_SUMMARY = path.join(PHASE_E_DIR, 'sample-summary.json');
export const FILE_PHASE_E_SELECTION_MANIFEST = path.join(
  PHASE_E_DIR,
  'selection-manifest.json'
);
export const FILE_PHASE_E_CANDIDATES_DRAFT = path.join(
  PHASE_E_DIR,
  'ai-candidates.json'
);
export const FILE_PHASE_E_CANDIDATES_IMPORTED = path.join(
  PHASE_E_DIR,
  'ai-candidates-imported.json'
);
export const FILE_PHASE_E_REVIEW = path.join(PHASE_E_DIR, 'ai-review.json');
export const FILE_PHASE_E_BATCH_OPERATIONS = path.join(
  PHASE_E_DIR,
  'batch-operations.json'
);
export const FILE_PHASE_E_QUALITY_REPORT = path.join(
  PHASE_E_DIR,
  'quality-report.json'
);
export const FILE_PHASE_E_CURSOR_PROGRESS = path.join(
  PHASE_E_DIR,
  'cursor-progress.json'
);
export const PHASE_E_CURSOR_CHUNKS_DIR = path.join(PHASE_E_DIR, 'cursor-chunks');
export const PHASE_E_PARTIAL_CANDIDATES_DIR = path.join(
  PHASE_E_DIR,
  'partial-candidates'
);

export const PHASE_E_CHUNK_SIZE = 20;
export const PHASE_E_TARGET_COUNT = 100;

/**
 * @param {string} batch_id
 */
export function normalize_test_batch_id(batch_id) {
  if (batch_id === TEST_BATCH_PHASE_E_100) {
    return TEST_BATCH_PHASE_E_100;
  }
  return TEST_BATCH_V2_30;
}

/**
 * @param {string} batch_id
 */
export function get_test_batch_config(batch_id) {
  const id = normalize_test_batch_id(batch_id);
  if (id === TEST_BATCH_PHASE_E_100) {
    return {
      test_batch_id: TEST_BATCH_PHASE_E_100,
      label_zh: '第六階段 E（100 首品質測試）',
      sample_file: FILE_PHASE_E_SAMPLE,
      candidates_imported_file: FILE_PHASE_E_CANDIDATES_IMPORTED,
      candidates_draft_file: FILE_PHASE_E_CANDIDATES_DRAFT,
      review_file: FILE_PHASE_E_REVIEW,
      batch_operations_file: FILE_PHASE_E_BATCH_OPERATIONS,
      candidate_version: AI_CANDIDATE_VERSION_V2,
      batch_review_max: 30,
      supports_v1_compare: false,
    };
  }
  return {
    test_batch_id: TEST_BATCH_V2_30,
    label_zh: 'v2 測試樣本（30 首）',
    sample_file: FILE_AI_SAMPLE,
    candidates_imported_file: FILE_AI_CANDIDATES_V2,
    candidates_draft_file: null,
    review_file: FILE_AI_REVIEW_V2,
    batch_operations_file: FILE_AI_BATCH_OPERATIONS_V2,
    candidate_version: AI_CANDIDATE_VERSION_V2,
    batch_review_max: 30,
    supports_v1_compare: true,
  };
}

export function list_test_batches_status() {
  const out = [];
  for (let i = 0; i < AI_TEST_BATCH_IDS.length; i += 1) {
    out.push(summarize_test_batch(AI_TEST_BATCH_IDS[i]));
  }
  return out;
}

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function count_candidates(doc) {
  return doc && doc.candidates ? doc.candidates.length : 0;
}

/**
 * @param {string} batch_id
 */
export function summarize_test_batch(batch_id) {
  const cfg = get_test_batch_config(batch_id);
  const sample = read_json(cfg.sample_file);
  const imported = read_json(cfg.candidates_imported_file);
  const review = read_json(cfg.review_file);
  const track_ids = sample && sample.track_ids ? sample.track_ids : [];
  const candidate_ids = {};
  if (imported && imported.candidates) {
    for (let c = 0; c < imported.candidates.length; c += 1) {
      candidate_ids[imported.candidates[c].spotify_id] = true;
    }
  }
  let pending = 0;
  let accepted = 0;
  let rejected = 0;
  let modified = 0;
  for (let t = 0; t < track_ids.length; t += 1) {
    const id = track_ids[t];
    const rev =
      review && review.reviews_by_track_id && review.reviews_by_track_id[id]
        ? review.reviews_by_track_id[id].status
        : 'pending';
    if (rev === 'accepted') {
      accepted += 1;
    } else if (rev === 'rejected') {
      rejected += 1;
    } else if (rev === 'modified') {
      modified += 1;
    } else {
      pending += 1;
    }
  }
  const ai_completed = Object.keys(candidate_ids).length;
  return {
    test_batch_id: cfg.test_batch_id,
    label_zh: cfg.label_zh,
    sample_id: sample ? sample.sample_id : null,
    track_count: track_ids.length,
    ai_candidates_count: ai_completed,
    ai_pending_analysis: Math.max(0, track_ids.length - ai_completed),
    review_stats: {
      pending,
      accepted,
      rejected,
      modified,
      total: track_ids.length,
    },
    imported_at: imported ? imported.imported_at : null,
    has_sample: !!sample,
    has_candidates: ai_completed > 0,
  };
}
