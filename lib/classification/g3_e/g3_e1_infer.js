/**
 * G3-E.1 infer：僅寫入 Agent 推理產物，缺則 fail-closed
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../../atomic_json.js';
import { G3_E1_AGENT_INFERENCES } from './g3_e1_agent_inferences.js';
import { stable_json_hash } from './g3_e1_hash.js';
import { G3_E1_RUN_ID, G3_E1_STAGED_DIR } from './paths_e1.js';

export class G3E1InferMissingError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'G3E1InferMissingError';
  }
}

/**
 * @param {object} sample_doc
 * @param {object} input_manifest
 * @param {{ write?: boolean }} [opts]
 */
export function run_g3_e1_infer(sample_doc, input_manifest, opts) {
  const options = opts || {};
  const write = options.write !== false;

  const expected_ids = sample_doc.tracks.map(function (t) {
    return t.track_id;
  });

  if (!G3_E1_AGENT_INFERENCES || G3_E1_AGENT_INFERENCES.length !== expected_ids.length) {
    throw new G3E1InferMissingError(
      'infer 缺少 Agent 推理列（G3_E1_AGENT_INFERENCES 須為 ' + expected_ids.length + ' 首）'
    );
  }

  const by_id = {};
  for (let i = 0; i < G3_E1_AGENT_INFERENCES.length; i += 1) {
    by_id[G3_E1_AGENT_INFERENCES[i].track_id] = G3_E1_AGENT_INFERENCES[i];
  }

  /** @type {object[]} */
  const run_entries = [];

  for (let j = 0; j < expected_ids.length; j += 1) {
    const id = expected_ids[j];
    const row = by_id[id];
    if (!row) {
      throw new G3E1InferMissingError('infer 缺少 track_id ' + id);
    }
    const input_entry = input_manifest.entries.find(function (e) {
      return e.track_id === id;
    });
    const output_hash = stable_json_hash(row);
    const staged_rel = 'staged-inferences/' + id + '-inference.json';

    if (write) {
      fs.mkdirSync(G3_E1_STAGED_DIR, { recursive: true });
      write_json_atomic(path.join(G3_E1_STAGED_DIR, id + '-inference.json'), {
        schema_version: 1,
        run_id: G3_E1_RUN_ID,
        track_id: id,
        output_hash: output_hash,
        inference: row,
      });
    }

    run_entries.push({
      run_id: G3_E1_RUN_ID,
      track_id: id,
      input_hash: input_entry ? input_entry.input_hash : null,
      output_hash: output_hash,
      model_name: null,
      model_api_session_id: null,
      execution_method: 'cursor_ide_agent_chat_turn',
      batch_id: 'g3-e1-pilot-5',
      generated_at: new Date().toISOString(),
      provenance_status: 'agent_workflow_declared',
      provenance_unverified: true,
      validation_pending: true,
      staged_output_file: staged_rel,
      evidence_gap_zh: '無 Cursor API 呼叫紀錄；可稽核 input/output hash 與 staged 檔對照',
    });
  }

  return {
    run_manifest: {
      schema_version: 1,
      run_id: G3_E1_RUN_ID,
      track_count: run_entries.length,
      entries: run_entries,
    },
    inferences: G3_E1_AGENT_INFERENCES,
  };
}
