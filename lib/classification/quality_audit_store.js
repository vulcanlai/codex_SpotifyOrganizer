/**
 * 品質驗證結果（與 ai-review / manual-overrides 隔離）
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../atomic_json.js';
import {
  FILE_PHASE_F_VERIFICATION,
  PHASE_F_AUDIT_ID,
  PHASE_F_SCHEMA_VERSION,
  VERDICT_UNSET,
  VERDICT_VALUES,
  WRONG_DIMENSION_VALUES,
} from './quality_audit_paths.js';
import { load_phase_f_sample } from './phase_f_sample.js';

export class QualityAuditValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QualityAuditValidationError';
  }
}

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function empty_verification_doc(sample_doc) {
  const sample = sample_doc || load_phase_f_sample();
  return {
    schema_version: PHASE_F_SCHEMA_VERSION,
    audit_id: PHASE_F_AUDIT_ID,
    sample_id: sample ? sample.sample_id : null,
    source_test_batch_id: sample ? sample.source_test_batch_id : null,
    source_sample_id: sample ? sample.source_sample_id : null,
    source_candidates_fingerprint: sample
      ? sample.source_candidates_fingerprint
      : null,
    updated_at: null,
    reviews_by_track_id: {},
  };
}

export function load_quality_verification() {
  const sample = load_phase_f_sample();
  let doc = read_json(FILE_PHASE_F_VERIFICATION);
  if (!doc) {
    return empty_verification_doc(sample);
  }
  if (sample && doc.sample_id && doc.sample_id !== sample.sample_id) {
    return empty_verification_doc(sample);
  }
  if (!doc.reviews_by_track_id) {
    doc.reviews_by_track_id = {};
  }
  return doc;
}

function validate_review_payload(body) {
  if (!body || !body.spotify_id) {
    throw new QualityAuditValidationError('缺少 spotify_id');
  }
  const verdict = body.verdict || VERDICT_UNSET;
  if (VERDICT_VALUES.indexOf(verdict) < 0) {
    throw new QualityAuditValidationError('verdict 非法');
  }
  const dims = body.wrong_dimensions || [];
  if (!Array.isArray(dims)) {
    throw new QualityAuditValidationError('wrong_dimensions 必須為陣列');
  }
  for (let i = 0; i < dims.length; i += 1) {
    if (WRONG_DIMENSION_VALUES.indexOf(dims[i]) < 0) {
      throw new QualityAuditValidationError('wrong_dimensions 含非法值');
    }
  }
  const note = body.note != null ? String(body.note) : '';
  if (note.length > 4000) {
    throw new QualityAuditValidationError('備註過長');
  }
  return { verdict, dims, note };
}

/**
 * @param {object} body
 * @param {object} [opts]
 */
export function save_quality_review(body, opts) {
  const options = opts || {};
  const sample = options.sample_doc || load_phase_f_sample();
  if (!sample || !sample.track_ids) {
    throw new QualityAuditValidationError('尚未建立 phase-f 抽樣');
  }
  const allowed = {};
  for (let i = 0; i < sample.track_ids.length; i += 1) {
    allowed[sample.track_ids[i]] = true;
  }
  const parsed = validate_review_payload(body);
  if (!allowed[body.spotify_id]) {
    throw new QualityAuditValidationError('不在品質驗證樣本內');
  }

  let doc = options.doc || load_quality_verification();
  if (!doc.reviews_by_track_id) {
    doc.reviews_by_track_id = {};
  }
  const now = new Date().toISOString();
  doc.schema_version = PHASE_F_SCHEMA_VERSION;
  doc.audit_id = PHASE_F_AUDIT_ID;
  doc.sample_id = sample.sample_id;
  doc.source_test_batch_id = sample.source_test_batch_id;
  doc.source_sample_id = sample.source_sample_id;
  doc.source_candidates_fingerprint = sample.source_candidates_fingerprint;
  doc.updated_at = now;

  if (parsed.verdict === VERDICT_UNSET) {
    delete doc.reviews_by_track_id[body.spotify_id];
  } else {
    doc.reviews_by_track_id[body.spotify_id] = {
      verdict: parsed.verdict,
      wrong_dimensions: parsed.dims,
      note: parsed.note,
      updated_at: now,
      source: 'classify:ui-quality-audit',
    };
  }

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(FILE_PHASE_F_VERIFICATION), { recursive: true });
    write_json_atomic(FILE_PHASE_F_VERIFICATION, doc);
  }
  return doc;
}
