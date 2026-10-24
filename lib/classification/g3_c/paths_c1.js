/**
 * G3-C.1 統一分類檢視（衍生、可重建）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_C1_DIR = path.join(CLASSIFICATION_DIR, 'g3-c1-unified-view');

export const FILE_G3_C1_UNIFIED_INDEX = path.join(G3_C1_DIR, 'unified-classification-view.json');
export const FILE_G3_C1_UNIFIED_SUMMARY = path.join(G3_C1_DIR, 'unified-view-summary.json');
export const FILE_G3_C1_FIELD_TASKS = path.join(G3_C1_DIR, 'field-evidence-tasks-g3c1.json');
export const FILE_G3_C1_PREVIEW_COVERAGE = path.join(G3_C1_DIR, 'smart-preview-coverage.json');

export const G3_C1_SCHEMA_VERSION = 1;

export const SOURCE_TIER_HUMAN = 'human_confirmed';
export const SOURCE_TIER_EVIDENCE = 'verified_evidence';
export const SOURCE_TIER_AI = 'ai_suggestion';
export const SOURCE_TIER_RULE = 'rule_inference';
export const SOURCE_TIER_UNKNOWN = 'unknown';
