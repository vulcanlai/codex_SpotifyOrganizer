/**
 * 智慧分類輸出路徑（僅寫入 backup/classification/）
 */
import path from 'node:path';
import { project_root } from '../config.js';

export const CLASSIFICATION_DIR = path.join(
  project_root,
  'backup',
  'classification'
);

export const FILE_CLASSIFICATION_INDEX = path.join(
  CLASSIFICATION_DIR,
  'classification-index.json'
);
export const FILE_CLASSIFICATION_SUMMARY = path.join(
  CLASSIFICATION_DIR,
  'classification-summary.json'
);
export const FILE_MANUAL_OVERRIDES = path.join(
  CLASSIFICATION_DIR,
  'manual-overrides.json'
);

export const CLASSIFICATION_INDEX_SCHEMA_VERSION = 2;
export const CLASSIFICATION_SUMMARY_SCHEMA_VERSION = 2;
export const GENRE_TAXONOMY_VERSION = 1;
export const MANUAL_OVERRIDES_SCHEMA_VERSION = 1;

export const AI_TEST_DIR = path.join(CLASSIFICATION_DIR, 'ai-test');
export const FILE_AI_SAMPLE = path.join(AI_TEST_DIR, 'sample-30.json');
export const FILE_AI_SAMPLE_SUMMARY = path.join(AI_TEST_DIR, 'sample-summary.json');
export const FILE_AI_CURSOR_INPUT = path.join(AI_TEST_DIR, 'cursor-ai-input.md');
export const FILE_AI_CANDIDATES_DRAFT = path.join(
  AI_TEST_DIR,
  'ai-candidates.json'
);

export const AI_TEST_V1_DIR = path.join(AI_TEST_DIR, 'v1');
export const AI_TEST_V2_DIR = path.join(AI_TEST_DIR, 'v2');

export const FILE_AI_CANDIDATES = path.join(
  CLASSIFICATION_DIR,
  'ai-candidates.json'
);
export const FILE_AI_REVIEW = path.join(CLASSIFICATION_DIR, 'ai-review.json');

export const FILE_AI_CANDIDATES_V1 = path.join(
  AI_TEST_V1_DIR,
  'ai-candidates.json'
);
export const FILE_AI_REVIEW_V1 = path.join(AI_TEST_V1_DIR, 'ai-review.json');

export const FILE_AI_CANDIDATES_V2_DRAFT = path.join(
  AI_TEST_V2_DIR,
  'ai-candidates.json'
);
export const FILE_AI_CANDIDATES_V2 = path.join(
  AI_TEST_V2_DIR,
  'ai-candidates-imported.json'
);
export const FILE_AI_REVIEW_V2 = path.join(AI_TEST_V2_DIR, 'ai-review.json');
export const FILE_AI_COMPARE_SUMMARY = path.join(
  AI_TEST_V2_DIR,
  'compare-summary.json'
);

export const AI_SAMPLE_SCHEMA_VERSION = 1;
export const AI_CANDIDATES_SCHEMA_VERSION = 1;
export const AI_CANDIDATES_V2_SCHEMA_VERSION = 2;
export const AI_REVIEW_SCHEMA_VERSION = 1;
export const AI_CANDIDATE_VERSION_V1 = 1;
export const AI_CANDIDATE_VERSION_V2 = 2;

export const FILE_CLASSIFICATION_SETTINGS = path.join(
  CLASSIFICATION_DIR,
  'classification-settings.json'
);
export const FILE_FORMAL_CLASSIFICATION_STATE = path.join(
  CLASSIFICATION_DIR,
  'formal-classification-state.json'
);
export const FILE_G3_F_ADOPT_REGISTRY = path.join(
  CLASSIFICATION_DIR,
  'g3-f-adopt-registry.json'
);
export const G3_F_ADOPT_REGISTRY_SCHEMA_VERSION = 1;
export const FILE_AI_BATCH_OPERATIONS_V2 = path.join(
  AI_TEST_V2_DIR,
  'batch-operations.json'
);

export const CLASSIFICATION_SETTINGS_SCHEMA_VERSION = 1;
export const FORMAL_CLASSIFICATION_STATE_SCHEMA_VERSION = 1;
export const BATCH_REVIEW_MAX_DEFAULT = 30;
