/**
 * G3-F 採用 registry（獨立於 manual-overrides）
 */
import fs from 'node:fs';
import {
  FILE_G3_F_ADOPT_REGISTRY,
  G3_F_ADOPT_REGISTRY_SCHEMA_VERSION,
} from '../paths.js';
import { write_json_atomic } from '../../atomic_json.js';
import { G3_F_ADOPT_REGISTRY_SOURCE } from './g3_f_eligible.js';

export function empty_g3_f_adopt_registry() {
  return {
    schema_version: G3_F_ADOPT_REGISTRY_SCHEMA_VERSION,
    updated_at: null,
    default_source: G3_F_ADOPT_REGISTRY_SOURCE,
    adoptions_by_track_id: {},
  };
}

/**
 * @param {object} [opts]
 */
export function load_g3_f_adopt_registry(opts) {
  const options = opts || {};
  const file_path = options.file_path || FILE_G3_F_ADOPT_REGISTRY;
  if (!fs.existsSync(file_path)) {
    return empty_g3_f_adopt_registry();
  }
  const doc = JSON.parse(fs.readFileSync(file_path, 'utf8'));
  if (!doc.adoptions_by_track_id) {
    doc.adoptions_by_track_id = {};
  }
  return doc;
}

/**
 * @param {object} doc
 * @param {object} [opts]
 */
export function save_g3_f_adopt_registry(doc, opts) {
  const options = opts || {};
  const file_path = options.file_path || FILE_G3_F_ADOPT_REGISTRY;
  const next = {
    ...doc,
    schema_version: G3_F_ADOPT_REGISTRY_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
  };
  write_json_atomic(file_path, next);
  return next;
}

/**
 * @param {object} candidate eligible 列
 * @param {string} [source]
 */
export function build_registry_entry_from_candidate(candidate, source) {
  const src = source || G3_F_ADOPT_REGISTRY_SOURCE;
  const id = candidate.track_id;
  return {
    status: 'adopted',
    track_id: id,
    wave_id: candidate.wave_id,
    wave_number: candidate.wave_number,
    batch_id: candidate.batch_id,
    staged_path: candidate.staged_path,
    confidence_tier: candidate.confidence_tier,
    source: src,
    inference_source: candidate.inference_source || null,
    inference_snapshot: candidate.inference || null,
    adopted_classification: candidate.adopted_classification,
    adopted_at: new Date().toISOString(),
    idempotency_key: candidate.wave_id + ':' + id + ':' + src,
  };
}

/**
 * 冪等 merge：已存在且 idempotency_key 相同 → skipped；key 不同 → conflict
 * @param {object} registry_doc
 * @param {object[]} candidates
 */
export function merge_g3_f_adopt_batch_idempotent(registry_doc, candidates) {
  const doc = registry_doc || empty_g3_f_adopt_registry();
  const by = { ...(doc.adoptions_by_track_id || {}) };
  /** @type {object[]} */
  const applied = [];
  /** @type {object[]} */
  const skipped = [];
  /** @type {object[]} */
  const conflicts = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    const entry = build_registry_entry_from_candidate(c);
    const prev = by[c.track_id];
    if (!prev) {
      by[c.track_id] = entry;
      applied.push({ track_id: c.track_id, action: 'insert' });
      continue;
    }
    if (prev.idempotency_key === entry.idempotency_key) {
      skipped.push({ track_id: c.track_id, reason: 'idempotent_skip' });
      continue;
    }
    conflicts.push({
      track_id: c.track_id,
      reason: 'existing_different_idempotency_key',
      existing_key: prev.idempotency_key,
      incoming_key: entry.idempotency_key,
    });
  }

  return {
    registry_doc: {
      ...doc,
      adoptions_by_track_id: by,
    },
    applied: applied,
    skipped: skipped,
    conflicts: conflicts,
  };
}
