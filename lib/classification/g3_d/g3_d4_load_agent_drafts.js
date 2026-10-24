/**
 * 讀取 G3-D.4 cursor-agent-drafts 批次
 */
import fs from 'node:fs';
import path from 'node:path';
import { validate_g3_d4_agent_batch } from './g3_d4_validate_agent_batch.js';
import { G3_D4_AGENT_DRAFTS_DIR } from './paths_d4.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';

/**
 * @param {object} reconcile_doc
 * @param {{ validate?: boolean }} [opts]
 */
export function load_g3_d4_agent_batches(reconcile_doc, opts) {
  const options = opts || {};
  const validate = options.validate !== false;
  const ev = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};

  /** @type {object[]} */
  const merged = [];
  const batch_status = [];

  for (let b = 0; b < reconcile_doc.batches.length; b += 1) {
    const batch = reconcile_doc.batches[b];
    const file_path = path.join(G3_D4_AGENT_DRAFTS_DIR, batch.batch_id + '.json');
    const entry = {
      batch_id: batch.batch_id,
      batch_index: batch.batch_index,
      expected_count: batch.count,
      file_path: file_path,
      status: 'missing',
      actual_count: 0,
      error_zh: null,
    };

    if (!fs.existsSync(file_path)) {
      batch_status.push(entry);
      continue;
    }

    try {
      const doc = JSON.parse(fs.readFileSync(file_path, 'utf8'));
      const tracks = doc.tracks || [];
      entry.actual_count = tracks.length;
      if (validate) {
        validate_g3_d4_agent_batch(doc, batch.track_ids, ev);
      }
      if (tracks.length !== batch.count) {
        throw new Error('曲目數 ' + tracks.length + ' 與計畫 ' + batch.count + ' 不符');
      }
      entry.status = 'ok';
      merged.push.apply(merged, tracks);
    } catch (e) {
      entry.status = 'failed';
      entry.error_zh = e.message || String(e);
    }
    batch_status.push(entry);
  }

  return {
    tracks: merged,
    batch_status: batch_status,
    success_count: merged.length,
    completed_batches: batch_status.filter(function (x) {
      return x.status === 'ok';
    }).length,
  };
}
