/**
 * G3-D.1 第一波 200 首 AI 擴展（衍生資料）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_D1_WAVE_DIR = path.join(CLASSIFICATION_DIR, 'g3-d1-wave-200');

export const FILE_G3_D1_SAMPLE_200 = path.join(G3_D1_WAVE_DIR, 'sample-200.json');
export const FILE_G3_D1_POOL_SUMMARY = path.join(G3_D1_WAVE_DIR, 'needs-new-ai-pool-summary.json');
export const FILE_G3_D1_EXCLUSIONS = path.join(G3_D1_WAVE_DIR, 'selection-exclusions.jsonl');
export const FILE_G3_D1_STRATIFICATION = path.join(G3_D1_WAVE_DIR, 'stratification-report.json');
export const FILE_G3_D1_BATCH_PLAN = path.join(G3_D1_WAVE_DIR, 'batch-plan-200.json');
export const FILE_G3_D1_BATCH_PROGRESS = path.join(G3_D1_WAVE_DIR, 'batch-progress-200.json');
export const FILE_G3_D1_PRECHECK = path.join(G3_D1_WAVE_DIR, 'pre-execution-check.json');
export const FILE_G3_D1_OFFLINE_SUMMARY = path.join(G3_D1_WAVE_DIR, 'offline-summary.json');
export const FILE_G3_D1_MERGED_QUALITY = path.join(G3_D1_WAVE_DIR, 'merged-quality-report-200.json');
export const FILE_G3_D1_EXECUTION_LOG = path.join(G3_D1_WAVE_DIR, 'execution-log.json');
export const FILE_G3_D1_BATCH_IMPORT_LOG = path.join(G3_D1_WAVE_DIR, 'batch-import-log.json');
export const FILE_G3_D1_PREVIEW_IMPACT = path.join(G3_D1_WAVE_DIR, 'smart-playlist-preview-impact.json');

export const G3_D1_BATCH_INPUTS_DIR = path.join(G3_D1_WAVE_DIR, 'batch-inputs');
export const G3_D1_CURSOR_DRAFTS_DIR = path.join(G3_D1_WAVE_DIR, 'cursor-drafts');
export const G3_D1_BATCH_DRAFTS_DIR = path.join(G3_D1_WAVE_DIR, 'batch-drafts');
export const G3_D1_QC_DIR = path.join(G3_D1_WAVE_DIR, 'quality-checkpoints');

export const G3_D1_SCHEMA_VERSION = 1;
export const G3_D1_SELECTION_SEED = 'g3-d1:stratified-200:v1';
export const G3_D1_BATCH_SIZE = 7;
export const G3_D1_WAVE_SIZE = 200;
