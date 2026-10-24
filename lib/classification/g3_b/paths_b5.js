/**
 * G3-B.5 百首樣本規劃（衍生資料）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_B5_TRIAL_DIR = path.join(CLASSIFICATION_DIR, 'g3-b5-trial-100');

export const FILE_G3_B5_SAMPLE_100 = path.join(G3_B5_TRIAL_DIR, 'sample-100.json');
export const FILE_G3_B5_REUSE_30 = path.join(G3_B5_TRIAL_DIR, 'reuse-cohort-30.json');
export const FILE_G3_B5_NEW_70 = path.join(G3_B5_TRIAL_DIR, 'new-sample-70.json');
export const FILE_G3_B5_AI_NEEDED = path.join(G3_B5_TRIAL_DIR, 'ai-generation-needed.json');
export const FILE_G3_B5_BATCH_PLAN = path.join(G3_B5_TRIAL_DIR, 'batch-plan-100.json');
export const FILE_G3_B5_BATCH_PROGRESS = path.join(G3_B5_TRIAL_DIR, 'batch-progress-100.json');
export const FILE_G3_B5_STRATIFICATION = path.join(G3_B5_TRIAL_DIR, 'stratification-report.json');
export const FILE_G3_B5_GENRE_DICT_REPORT = path.join(
  G3_B5_TRIAL_DIR,
  'genre-dictionary-quality-report.json'
);
export const FILE_G3_B5_UNIFIED_PLAN = path.join(G3_B5_TRIAL_DIR, 'unified-classification-plan.json');
export const FILE_G3_B5_HUMAN_REVIEW_STRATEGY = path.join(
  G3_B5_TRIAL_DIR,
  'human-review-strategy.json'
);
export const FILE_G3_B5_OFFLINE_SUMMARY = path.join(G3_B5_TRIAL_DIR, 'offline-summary.json');

export const G3_B5_SCHEMA_VERSION = 1;
export const G3_B5_SELECTION_SEED = 'g3-b5:stratified-70:v1';
export const G3_B5_BATCH_SIZE = 7;
