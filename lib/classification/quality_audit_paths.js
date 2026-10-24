/**
 * 第六階段 F：AI 品質驗證（20 首抽樣）路徑
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from './paths.js';

export const QUALITY_AUDIT_DIR = path.join(CLASSIFICATION_DIR, 'quality-audit');
export const PHASE_F_DIR = path.join(QUALITY_AUDIT_DIR, 'phase-f-20');
export const FILE_PHASE_F_DIR = PHASE_F_DIR;

export const PHASE_F_AUDIT_ID = 'phase-f-20';
export const PHASE_F_SCHEMA_VERSION = 1;
export const PHASE_F_TARGET_COUNT = 20;

export const FILE_PHASE_F_SAMPLE = path.join(PHASE_F_DIR, 'sample-20.json');
export const FILE_PHASE_F_SELECTION_MANIFEST = path.join(
  PHASE_F_DIR,
  'selection-manifest.json'
);
export const FILE_PHASE_F_VERIFICATION = path.join(
  PHASE_F_DIR,
  'verification.json'
);
export const FILE_PHASE_F_REPORT = path.join(PHASE_F_DIR, 'quality-report.json');
export const FILE_PHASE_F_BUILD_SNAPSHOT = path.join(
  PHASE_F_DIR,
  'build-snapshot.json'
);

/** 人工品質判定（非正式 AI 審核） */
export const VERDICT_CORRECT = 'correct';
export const VERDICT_PARTIAL = 'partial';
export const VERDICT_INCORRECT = 'incorrect';
export const VERDICT_UNDECIDABLE = 'undecidable';
export const VERDICT_UNSET = 'unset';

export const VERDICT_VALUES = [
  VERDICT_CORRECT,
  VERDICT_PARTIAL,
  VERDICT_INCORRECT,
  VERDICT_UNDECIDABLE,
  VERDICT_UNSET,
];

export const WRONG_DIMENSION_VALUES = [
  'primary_genre',
  'secondary_genre',
  'subgenre',
  'language',
  'context',
  'special_type',
];
