/**
 * G3 情緒試驗目錄（獨立於 G3-F wave／正式 registry）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const EMOTION_TRIAL_1A_DIR_NAME = 'g3-emotion-trial-1a';

export const EMOTION_TRIAL_1A_DIR = path.join(
  CLASSIFICATION_DIR,
  EMOTION_TRIAL_1A_DIR_NAME
);

export const FILE_EMOTION_TRIAL_1A_MANIFEST = path.join(
  EMOTION_TRIAL_1A_DIR,
  'trial-manifest.json'
);

export const FILE_EMOTION_TRIAL_1A_CSV = path.join(
  EMOTION_TRIAL_1A_DIR,
  'trial-sample-80.csv'
);

export const FILE_EMOTION_TRIAL_1A_SUMMARY = path.join(
  EMOTION_TRIAL_1A_DIR,
  'inventory-summary.json'
);

export const FILE_EMOTION_TRIAL_1A_REPORT_MD = path.join(
  EMOTION_TRIAL_1A_DIR,
  'inventory-report-zh.md'
);

/** 固定 seed（與規劃報告一致） */
export const EMOTION_TRIAL_1A_SEED = 'g3-em-trial:20261024:v1';

export const EMOTION_TRIAL_1A_STRATUM = {
  G3_F_HIGH: 'g3_f_high_genre',
  METADATA_COMPLETE: 'metadata_complete_not_high',
  METADATA_MISSING: 'metadata_missing',
};

export const EMOTION_TRIAL_1A_COUNTS = {
  g3_f_high_genre: 30,
  metadata_complete_not_high: 30,
  metadata_missing: 20,
};

export const EMOTION_TRIAL_1A_TOTAL = 80;
