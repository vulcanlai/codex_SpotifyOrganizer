/**
 * G3-C.2 驗收與擴大計畫（衍生報告）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_C2_DIR = path.join(CLASSIFICATION_DIR, 'g3-c2-acceptance');

export const FILE_G3_C2_PREVIEW_GAP = path.join(G3_C2_DIR, 'sample-100-preview-gap.json');
export const FILE_G3_C2_SOURCE_AUDIT = path.join(G3_C2_DIR, 'classification-source-audit.json');
export const FILE_G3_C2_FILTER_TESTS = path.join(G3_C2_DIR, 'smart-playlist-filter-tests.json');
export const FILE_G3_C2_EXPANSION_PLAN = path.join(G3_C2_DIR, 'expansion-plan-1895.json');
export const FILE_G3_C2_TEST_INVENTORY = path.join(G3_C2_DIR, 'npm-test-inventory.json');
export const FILE_G3_C2_OFFLINE_SUMMARY = path.join(G3_C2_DIR, 'offline-summary.json');

export const G3_C2_SCHEMA_VERSION = 1;
