/**
 * G3-B 試驗輸出（獨立草稿，不寫入正式分類）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_B_TRIAL_DIR = path.join(CLASSIFICATION_DIR, 'g3-b-trial-30');

export const FILE_G3_B_SAMPLE = path.join(G3_B_TRIAL_DIR, 'sample-30.json');
export const FILE_G3_B_RULE_DRAFT = path.join(G3_B_TRIAL_DIR, 'rule-classification-draft.json');
export const FILE_G3_B_AI_INPUT_JSON = path.join(G3_B_TRIAL_DIR, 'g3b-ai-input.json');
export const FILE_G3_B_AI_INPUT_MD = path.join(G3_B_TRIAL_DIR, 'cursor-g3b-input.md');
export const FILE_G3_B_AI_PENDING = path.join(G3_B_TRIAL_DIR, 'ai-pending-tracks.json');
export const FILE_G3_B_QUALITY_REPORT = path.join(G3_B_TRIAL_DIR, 'quality-report.json');
export const FILE_G3_B_PROGRESS = path.join(G3_B_TRIAL_DIR, 'progress.json');
export const FILE_G3_B_AI_DRAFT_IMPORTED = path.join(G3_B_TRIAL_DIR, 'ai-classification-draft.json');

export const G3_B_SCHEMA_VERSION = 1;
export const G3_B_SAMPLE_ID = 'g3-b-trial-v1';
