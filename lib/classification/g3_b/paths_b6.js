/**
 * G3-B.6 七十首 AI 分類執行（衍生資料）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';
import {
  FILE_G3_B5_BATCH_PLAN,
  FILE_G3_B5_BATCH_PROGRESS,
  FILE_G3_B5_SAMPLE_100,
} from './paths_b5.js';

export const G3_B6_TRIAL_DIR = path.join(CLASSIFICATION_DIR, 'g3-b6-trial-100');
export const G3_B6_CURSOR_DRAFTS_DIR = path.join(G3_B6_TRIAL_DIR, 'cursor-drafts');
export const G3_B6_BATCH_DRAFTS_DIR = path.join(G3_B6_TRIAL_DIR, 'batch-drafts');
export const FILE_G3_B6_EXECUTION_LOG = path.join(G3_B6_TRIAL_DIR, 'execution-log.json');
export const FILE_G3_B6_BATCH_IMPORT_LOG = path.join(G3_B6_TRIAL_DIR, 'batch-import-log.json');
export const FILE_G3_B6_MERGED_QUALITY = path.join(G3_B6_TRIAL_DIR, 'merged-quality-report-100.json');
export const FILE_G3_B6_EXPORT_INPUT_MD = path.join(G3_B6_TRIAL_DIR, 'cursor-g3b6-input-with-subgenres.md');

export {
  FILE_G3_B5_BATCH_PLAN,
  FILE_G3_B5_BATCH_PROGRESS,
  FILE_G3_B5_SAMPLE_100,
};

export const G3_B6_SCHEMA_VERSION = 1;
