/**
 * G3-B.3 固定順序批次計畫（5 首／批）
 */
import { G3_B3_BATCH_SIZE } from './paths_b3.js';

/**
 * @param {string[]} track_ids 固定順序
 * @param {number} [batch_size]
 * @param {{ batch_id_prefix?: string }} [opts]
 */
export function build_batch_plan(track_ids, batch_size, opts) {
  const options = opts || {};
  const size = batch_size || G3_B3_BATCH_SIZE;
  const prefix = options.batch_id_prefix || 'g3b3-batch-';
  const ids = track_ids.slice().sort();
  /** @type {object[]} */
  const batches = [];
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    const batch_index = Math.floor(i / size) + 1;
    batches.push({
      batch_id: prefix + String(batch_index).padStart(2, '0'),
      batch_index: batch_index,
      track_ids: chunk,
      track_count: chunk.length,
      status: 'pending',
    });
  }
  return {
    schema_version: 1,
    batch_size: size,
    total_tracks: ids.length,
    batch_count: batches.length,
    batches: batches,
  };
}

/**
 * @param {object} plan
 * @param {object} [existing_progress]
 */
export function init_batch_progress(plan, existing_progress) {
  if (existing_progress && existing_progress.batches) {
    return existing_progress;
  }
  const batches = (plan.batches || []).map(function (b) {
    return {
      batch_id: b.batch_id,
      status: 'pending',
      imported_track_ids: [],
      failed: [],
      updated_at: null,
    };
  });
  return {
    schema_version: 1,
    batches: batches,
    completed_batch_ids: [],
  };
}

/**
 * @param {object} progress
 * @param {string} batch_id
 */
export function is_batch_completed(progress, batch_id) {
  const list = progress.batches || [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].batch_id === batch_id && list[i].status === 'completed') {
      return true;
    }
  }
  return false;
}

/**
 * @param {object} progress
 * @param {string} batch_id
 * @param {object} result
 */
export function apply_batch_import_result(progress, batch_id, result) {
  const next = JSON.parse(JSON.stringify(progress));
  for (let i = 0; i < next.batches.length; i += 1) {
    if (next.batches[i].batch_id !== batch_id) {
      continue;
    }
    const row = next.batches[i];
    row.status = result.batch_failed ? 'failed' : 'completed';
    row.imported_track_ids = result.imported_track_ids || [];
    row.failed = result.failed || [];
    row.updated_at = new Date().toISOString();
    if (row.status === 'completed') {
      if (next.completed_batch_ids.indexOf(batch_id) < 0) {
        next.completed_batch_ids.push(batch_id);
      }
    }
  }
  return next;
}
