/**
 * G3-B.4 衍生輸出（草稿來源與合併報告）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_B4_TRIAL_DIR = path.join(CLASSIFICATION_DIR, 'g3-b4-trial-30');
export const G3_B4_CURSOR_DRAFTS_DIR = path.join(G3_B4_TRIAL_DIR, 'cursor-drafts');
export const FILE_G3_B4_MERGED_QUALITY = path.join(G3_B4_TRIAL_DIR, 'merged-quality-report.json');
export const FILE_G3_B4_EXECUTION_LOG = path.join(G3_B4_TRIAL_DIR, 'execution-log.json');

export const G3_B4_SCHEMA_VERSION = 1;
