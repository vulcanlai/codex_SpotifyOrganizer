/**
 * G3-A 統一證據索引路徑（衍生資料，可重建）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

const DEFAULT_G3_EVIDENCE_DIR = path.join(CLASSIFICATION_DIR, 'g3-evidence');

export function g3_evidence_dir() {
  const env = process.env.SPOTIFYORG_G3_EVIDENCE_DIR;
  if (env && String(env).trim()) {
    return path.resolve(String(env).trim());
  }
  return DEFAULT_G3_EVIDENCE_DIR;
}

export function file_g3_evidence_index() {
  return path.join(g3_evidence_dir(), 'evidence-index.json');
}

export function file_g3_coverage_summary() {
  return path.join(g3_evidence_dir(), 'coverage-summary.json');
}

export function file_g3_conflicts_report() {
  return path.join(g3_evidence_dir(), 'conflicts-report.json');
}

/** @deprecated 使用 file_g3_evidence_index() */
export const G3_EVIDENCE_DIR = DEFAULT_G3_EVIDENCE_DIR;
export const FILE_G3_EVIDENCE_INDEX = path.join(DEFAULT_G3_EVIDENCE_DIR, 'evidence-index.json');
export const FILE_G3_COVERAGE_SUMMARY = path.join(DEFAULT_G3_EVIDENCE_DIR, 'coverage-summary.json');
export const FILE_G3_CONFLICTS_REPORT = path.join(DEFAULT_G3_EVIDENCE_DIR, 'conflicts-report.json');

export const G3_EVIDENCE_SCHEMA_VERSION = 1;
