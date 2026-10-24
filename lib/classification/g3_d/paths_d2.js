/**
 * G3-D.2 品質稽核（衍生資料，不覆寫 D.1 原始匯入）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_D2_AUDIT_DIR = path.join(CLASSIFICATION_DIR, 'g3-d2-audit');

export const FILE_G3_D2_SUMMARY = path.join(G3_D2_AUDIT_DIR, 'offline-summary.json');
export const FILE_G3_D2_STATS_200 = path.join(G3_D2_AUDIT_DIR, 'quality-stats-200.json');
export const FILE_G3_D2_SOUNDTRACK_AUDIT = path.join(G3_D2_AUDIT_DIR, 'soundtrack-instrumental-audit-83.json');
export const FILE_G3_D2_UNKNOWN_AUDIT = path.join(G3_D2_AUDIT_DIR, 'unknown-primary-audit-72.json');
export const FILE_G3_D2_LANGUAGE_AUDIT = path.join(G3_D2_AUDIT_DIR, 'language-unconfirmed-audit-155.json');
export const FILE_G3_D2_SPOT_CHECK = path.join(G3_D2_AUDIT_DIR, 'spot-check-30.json');
export const FILE_G3_D2_AUTO_REVIEW_POLICY = path.join(G3_D2_AUDIT_DIR, 'auto-review-policy-check.json');
export const FILE_G3_D2_SOURCE_LINEAGE = path.join(G3_D2_AUDIT_DIR, 'classification-source-lineage-sample.jsonl');
export const FILE_G3_D2_TEMPLATE_ANALYSIS = path.join(G3_D2_AUDIT_DIR, 'template-inference-analysis.json');
export const FILE_G3_D2_QUALITY_OVERLAY = path.join(G3_D2_AUDIT_DIR, 'quality-review-overlay-d1-200.json');
export const FILE_G3_D2_PREVIEW_DELTA = path.join(G3_D2_AUDIT_DIR, 'smart-playlist-preview-delta.json');
export const FILE_G3_D2_NEXT_WAVE_PREREQS = path.join(G3_D2_AUDIT_DIR, 'next-wave-prerequisites.json');
export const FILE_G3_D2_SECOND_ROUND_CANDIDATES = path.join(
  G3_D2_AUDIT_DIR,
  'second-round-ai-candidates.json'
);

export const G3_D2_SCHEMA_VERSION = 1;
