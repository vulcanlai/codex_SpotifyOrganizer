/**
 * AI v1 測試檔快照（避免 npm test 污染正式 ai-review / sample）
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FILE_AI_SAMPLE,
  FILE_AI_CANDIDATES,
  FILE_AI_REVIEW,
  FILE_MANUAL_OVERRIDES,
  AI_TEST_V1_DIR,
} from '../../lib/classification/paths.js';

const GOLDEN_V1_SAMPLE_ID = 'cd3f5bbbd23f2733';

/**
 * 若 v1 封存與 live 不一致（常見於 export write:true 污染），還原封存副本
 * @returns {boolean}
 */
export function ensure_ai_v1_canonical_test_fixture() {
  const golden_review_path = path.join(AI_TEST_V1_DIR, 'ai-review.json');
  const golden_cand_path = path.join(AI_TEST_V1_DIR, 'ai-candidates.json');
  if (!fs.existsSync(golden_review_path) || !fs.existsSync(golden_cand_path)) {
    return false;
  }
  const golden_review = JSON.parse(fs.readFileSync(golden_review_path, 'utf8'));
  let live_review = null;
  if (fs.existsSync(FILE_AI_REVIEW)) {
    live_review = JSON.parse(fs.readFileSync(FILE_AI_REVIEW, 'utf8'));
  }
  const sentinel = golden_review.reviews_by_track_id['0WeN17PUto5ZdSqkUBDOsX'];
  const live_sentinel =
    live_review && live_review.reviews_by_track_id
      ? live_review.reviews_by_track_id['0WeN17PUto5ZdSqkUBDOsX']
      : null;
  const need_restore =
    !live_review ||
    live_review.sample_id !== golden_review.sample_id ||
    (sentinel && (!live_sentinel || live_sentinel.status !== sentinel.status));
  if (!need_restore) {
    return true;
  }
  const sample_path = find_golden_sample_30_path();
  if (!sample_path) {
    return false;
  }
  fs.writeFileSync(FILE_AI_REVIEW, fs.readFileSync(golden_review_path));
  fs.writeFileSync(FILE_AI_CANDIDATES, fs.readFileSync(golden_cand_path));
  fs.writeFileSync(FILE_AI_SAMPLE, fs.readFileSync(sample_path));
  return true;
}

/**
 * @returns {string|null}
 */
function find_golden_sample_30_path() {
  const snap_root = path.join(process.cwd(), 'backup', 'classification', 'snapshots');
  if (!fs.existsSync(snap_root)) {
    return null;
  }
  const dirs = fs
    .readdirSync(snap_root)
    .filter(function (name) {
      return name.indexOf('pre-phase-d-') === 0 || name.indexOf('test-snapshot-') === 0;
    })
    .sort()
    .reverse();
  for (let i = 0; i < dirs.length; i += 1) {
    const candidate = path.join(snap_root, dirs[i], 'sample-30.json');
    if (!fs.existsSync(candidate)) {
      continue;
    }
    const doc = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    if (doc.sample_id === GOLDEN_V1_SAMPLE_ID) {
      return candidate;
    }
  }
  return null;
}

/**
 * @returns {{ review: Buffer, candidates: Buffer, sample: Buffer, overrides: Buffer }}
 */
export function snapshot_ai_v1_fixture() {
  return {
    sample: fs.readFileSync(FILE_AI_SAMPLE),
    candidates: fs.readFileSync(FILE_AI_CANDIDATES),
    review: fs.readFileSync(FILE_AI_REVIEW),
    overrides: fs.readFileSync(FILE_MANUAL_OVERRIDES),
  };
}

/**
 * @param {{ review: Buffer, candidates: Buffer, sample: Buffer, overrides: Buffer }} snap
 */
export function restore_ai_v1_fixture(snap) {
  if (!snap) {
    return;
  }
  fs.writeFileSync(FILE_AI_SAMPLE, snap.sample);
  fs.writeFileSync(FILE_AI_CANDIDATES, snap.candidates);
  fs.writeFileSync(FILE_AI_REVIEW, snap.review);
  fs.writeFileSync(FILE_MANUAL_OVERRIDES, snap.overrides);
}
