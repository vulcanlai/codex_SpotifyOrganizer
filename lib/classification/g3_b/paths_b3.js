/**
 * G3-B.3 試驗輸出（獨立；不覆寫 G3-B.1 / G3-B.2）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_B3_TRIAL_DIR = path.join(CLASSIFICATION_DIR, 'g3-b3-trial-30');

export const FILE_G3_B3_REUSE_REGISTRY = path.join(G3_B3_TRIAL_DIR, 'reusable-ai-results.json');
export const FILE_G3_B3_STILL_NEEDS_GEN = path.join(G3_B3_TRIAL_DIR, 'still-needs-generation.json');
export const FILE_G3_B3_FIELD_TASKS = path.join(G3_B3_TRIAL_DIR, 'field-evidence-tasks.json');
export const FILE_G3_B3_BATCH_PLAN = path.join(G3_B3_TRIAL_DIR, 'batch-plan.json');
export const FILE_G3_B3_BATCH_PROGRESS = path.join(G3_B3_TRIAL_DIR, 'batch-progress.json');
export const FILE_G3_B3_DEDUP_STATS = path.join(G3_B3_TRIAL_DIR, 'dedup-stats.json');
export const FILE_G3_B3_OFFLINE_SUMMARY = path.join(G3_B3_TRIAL_DIR, 'offline-summary.json');
export const FILE_G3_B3_LEMON_TREE = path.join(G3_B3_TRIAL_DIR, 'lemon-tree-language-task.json');
export const FILE_G3_B3_BATCH_IMPORT_LOG = path.join(G3_B3_TRIAL_DIR, 'batch-import-log.json');
export const G3_B3_BATCH_DRAFTS_DIR = path.join(G3_B3_TRIAL_DIR, 'batch-drafts');

export const G3_B3_SCHEMA_VERSION = 1;
export const G3_B3_BATCH_SIZE = 5;
