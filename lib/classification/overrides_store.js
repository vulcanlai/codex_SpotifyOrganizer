/**
 * manual-overrides.json 讀寫
 */
import fs from 'node:fs';
import {
  CLASSIFICATION_DIR,
  FILE_MANUAL_OVERRIDES,
  MANUAL_OVERRIDES_SCHEMA_VERSION,
} from './paths.js';
import { write_json_atomic } from '../atomic_json.js';

export class ClassificationOverridesError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ClassificationOverridesError';
  }
}

export function empty_overrides_doc() {
  return {
    schema_version: MANUAL_OVERRIDES_SCHEMA_VERSION,
    updated_at: null,
    overrides_by_track_id: {},
  };
}

export function load_manual_overrides() {
  if (!fs.existsSync(FILE_MANUAL_OVERRIDES)) {
    return empty_overrides_doc();
  }
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(FILE_MANUAL_OVERRIDES, 'utf8'));
  } catch (err) {
    throw new ClassificationOverridesError(
      `無法解析 manual-overrides.json：${err && err.message ? err.message : err}`
    );
  }
  if (doc.schema_version !== MANUAL_OVERRIDES_SCHEMA_VERSION) {
    throw new ClassificationOverridesError('manual-overrides schema_version 不符。');
  }
  if (!doc.overrides_by_track_id || typeof doc.overrides_by_track_id !== 'object') {
    throw new ClassificationOverridesError('manual-overrides 缺少 overrides_by_track_id。');
  }
  return doc;
}

/**
 * @param {object} doc
 */
export function save_manual_overrides(doc) {
  if (!fs.existsSync(CLASSIFICATION_DIR)) {
    fs.mkdirSync(CLASSIFICATION_DIR, { recursive: true });
  }
  doc.schema_version = MANUAL_OVERRIDES_SCHEMA_VERSION;
  doc.updated_at = new Date().toISOString();
  write_json_atomic(FILE_MANUAL_OVERRIDES, doc);
  return doc;
}

/**
 * @param {object} doc
 * @param {string} track_id
 * @param {object|null} patch - null 表示清除該曲覆寫
 */
export function upsert_track_override(doc, track_id, patch) {
  if (!track_id) {
    throw new ClassificationOverridesError('缺少 track_id。');
  }
  if (patch == null || patch.clear === true) {
    delete doc.overrides_by_track_id[track_id];
    return doc;
  }
  const prev = doc.overrides_by_track_id[track_id] || {};
  doc.overrides_by_track_id[track_id] = {
    updated_at: new Date().toISOString(),
    source: patch.source || prev.source || 'classify:ui',
    language: patch.language !== undefined ? patch.language : prev.language,
    genres: patch.genres !== undefined ? patch.genres : prev.genres,
    contexts: patch.contexts !== undefined ? patch.contexts : prev.contexts,
    special_types:
      patch.special_types !== undefined ? patch.special_types : prev.special_types,
    genre_profile:
      patch.genre_profile !== undefined ? patch.genre_profile : prev.genre_profile,
    remove_genres:
      patch.remove_genres !== undefined ? patch.remove_genres : prev.remove_genres,
    remove_contexts:
      patch.remove_contexts !== undefined
        ? patch.remove_contexts
        : prev.remove_contexts,
    remove_special_types:
      patch.remove_special_types !== undefined
        ? patch.remove_special_types
        : prev.remove_special_types,
    exclude_dimensions:
      patch.exclude_dimensions !== undefined
        ? patch.exclude_dimensions
        : prev.exclude_dimensions,
    mvp_playlist_ids:
      patch.mvp_playlist_ids !== undefined
        ? patch.mvp_playlist_ids
        : prev.mvp_playlist_ids,
    emotion_playlist_ids:
      patch.emotion_playlist_ids !== undefined
        ? patch.emotion_playlist_ids
        : prev.emotion_playlist_ids,
    locked_dimensions:
      patch.locked_dimensions !== undefined
        ? patch.locked_dimensions
        : prev.locked_dimensions,
    note_zh: patch.note_zh !== undefined ? patch.note_zh : prev.note_zh,
  };
  return doc;
}
