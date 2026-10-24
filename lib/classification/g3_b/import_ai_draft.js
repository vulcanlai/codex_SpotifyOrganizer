/**
 * G3-B AI 草稿匯入（驗證 only；寫入 g3-b-trial-30 獨立檔）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { validate_g3_b_ai_draft } from './validate_ai_draft.js';
import { FILE_G3_B_AI_DRAFT_IMPORTED, G3_B_SCHEMA_VERSION } from './paths.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { normalize_vocal_language_fields } from './language_evidence.js';

export class G3BImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'G3BImportError';
  }
}

function load_evidence_by_id() {
  const path = file_g3_evidence_index();
  if (!fs.existsSync(path)) {
    return {};
  }
  const doc = JSON.parse(fs.readFileSync(path, 'utf8'));
  return doc.tracks || {};
}

/**
 * @param {object} doc
 * @param {{ write?: boolean, skip_pending_gate?: boolean }} [opts]
 */
export function import_g3_b_ai_draft(doc, opts) {
  const options = opts || {};
  const evidence_by_id = load_evidence_by_id();
  const validate_ctx = { evidence_by_id: evidence_by_id };
  if (options.allowed_track_ids && options.allowed_track_ids.length) {
    validate_ctx.allowed_track_ids = options.allowed_track_ids.slice();
  } else if (options.skip_pending_gate) {
    validate_ctx.allowed_track_ids = doc.tracks.map(function (t) {
      return t.track_id;
    });
  }
  validate_g3_b_ai_draft(doc, validate_ctx);

  const tracks_normalized = doc.tracks.map(function (row) {
    if (row.human_locked === true) {
      return row;
    }
    const ev = evidence_by_id[row.track_id] || { track_id: row.track_id, identity: {} };
    const copy = Object.assign({}, row);
    if (copy.language) {
      copy.language = normalize_vocal_language_fields(copy.language, ev);
    }
    return copy;
  });

  const out = {
    schema_version: G3_B_SCHEMA_VERSION,
    imported_at: new Date().toISOString(),
    source: doc.source || 'cursor_ai_manual_import',
    model_note: doc.model_note || null,
    tracks: tracks_normalized,
  };
  if (options.write !== false) {
    write_json_atomic(FILE_G3_B_AI_DRAFT_IMPORTED, out);
  }
  return out;
}

/**
 * @param {string} path
 */
export function import_g3_b_ai_draft_from_file(path) {
  if (!fs.existsSync(path)) {
    throw new G3BImportError('找不到檔案：' + path);
  }
  const doc = JSON.parse(fs.readFileSync(path, 'utf8'));
  return import_g3_b_ai_draft(doc, { write: true });
}
