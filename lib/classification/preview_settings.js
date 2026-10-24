/**
 * 本機預覽模式設定（不寫入 confirmed）
 */
import fs from 'node:fs';
import {
  CLASSIFICATION_DIR,
  FILE_CLASSIFICATION_SETTINGS,
  CLASSIFICATION_SETTINGS_SCHEMA_VERSION,
  BATCH_REVIEW_MAX_DEFAULT,
} from './paths.js';
import { write_json_atomic } from '../atomic_json.js';

export const PREVIEW_MODE_STRICT = 'strict';
export const PREVIEW_MODE_BALANCED = 'balanced';
export const PREVIEW_MODE_RELAXED = 'relaxed';

export const PREVIEW_MODE_VALUES = [
  PREVIEW_MODE_STRICT,
  PREVIEW_MODE_BALANCED,
  PREVIEW_MODE_RELAXED,
];

export function default_settings_doc() {
  return {
    schema_version: CLASSIFICATION_SETTINGS_SCHEMA_VERSION,
    updated_at: null,
    preview_mode: PREVIEW_MODE_BALANCED,
    batch_review_max: BATCH_REVIEW_MAX_DEFAULT,
    active_test_batch: 'v2-sample-30',
  };
}

export function load_classification_settings() {
  if (!fs.existsSync(FILE_CLASSIFICATION_SETTINGS)) {
    return default_settings_doc();
  }
  const doc = JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_SETTINGS, 'utf8'));
  if (!doc.preview_mode) {
    doc.preview_mode = PREVIEW_MODE_BALANCED;
  }
  if (!doc.batch_review_max) {
    doc.batch_review_max = BATCH_REVIEW_MAX_DEFAULT;
  }
  if (!doc.active_test_batch) {
    doc.active_test_batch = 'v2-sample-30';
  }
  return doc;
}

export function save_classification_settings(doc) {
  if (!fs.existsSync(CLASSIFICATION_DIR)) {
    fs.mkdirSync(CLASSIFICATION_DIR, { recursive: true });
  }
  const out = Object.assign(default_settings_doc(), doc || {});
  if (PREVIEW_MODE_VALUES.indexOf(out.preview_mode) < 0) {
    out.preview_mode = PREVIEW_MODE_BALANCED;
  }
  if (out.batch_review_max > BATCH_REVIEW_MAX_DEFAULT) {
    out.batch_review_max = BATCH_REVIEW_MAX_DEFAULT;
  }
  if (out.batch_review_max < 1) {
    out.batch_review_max = 1;
  }
  out.updated_at = new Date().toISOString();
  write_json_atomic(FILE_CLASSIFICATION_SETTINGS, out);
  return out;
}
