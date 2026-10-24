/**
 * G3-B.2 試驗輸出（獨立於 g3-b-trial-30，不覆寫 G3-B.1）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_B2_TRIAL_DIR = path.join(CLASSIFICATION_DIR, 'g3-b2-trial-30');

export const FILE_G3_B2_QUEUE_STATES = path.join(G3_B2_TRIAL_DIR, 'queue-states.json');
export const FILE_G3_B2_AI_PENDING = path.join(G3_B2_TRIAL_DIR, 'ai-pending-generation.json');
export const FILE_G3_B2_REEVAL_SUMMARY = path.join(G3_B2_TRIAL_DIR, 're-evaluation-summary.json');
export const FILE_G3_B2_AUTO_REVIEW = path.join(G3_B2_TRIAL_DIR, 'auto-review-g3b1-draft.json');
export const FILE_G3_B2_LANGUAGE_CORRECTIONS = path.join(
  G3_B2_TRIAL_DIR,
  'language-corrections.json'
);
export const FILE_G3_B2_QUEUE_PROGRESS = path.join(G3_B2_TRIAL_DIR, 'queue-progress.json');
export const FILE_G3_B2_EXCLUDED_COMPARE = path.join(
  G3_B2_TRIAL_DIR,
  'formerly-excluded-17.json'
);

export const G3_B2_SCHEMA_VERSION = 1;

/** G3-B.1 唯讀參考 */
export const FILE_G3_B1_AI_DRAFT_READONLY = path.join(
  CLASSIFICATION_DIR,
  'g3-b-trial-30',
  'ai-classification-draft.json'
);
export const FILE_G3_B1_AI_PENDING_READONLY = path.join(
  CLASSIFICATION_DIR,
  'g3-b-trial-30',
  'ai-pending-tracks.json'
);
