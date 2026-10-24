/**
 * G3-E 共用：讀取 Agent 輸出 JSON（缺則 fail-closed）
 */
import fs from 'node:fs';
import path from 'node:path';
import { stable_json_hash } from './g3_e1_hash.js';

export class G3EAgentOutputMissingError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'G3EAgentOutputMissingError';
  }
}

/** @deprecated 相容 E.2 測試 */
export const G3E2AgentOutputMissingError = G3EAgentOutputMissingError;

function normalize_track_row(row) {
  if (!row.provenance) {
    row.provenance = {
      status: 'agent_workflow_declared',
      provenance_unverified: true,
      model_api_session_id: null,
      model_name: null,
      execution_method: 'cursor_ide_agent_json_batch',
      note_zh: 'Agent 寫入 JSON；無 API session 紀錄',
    };
  }
  if (row.provenance.model_api_session_id) {
    throw new Error('不得虛構 session_id：' + row.track_id);
  }
  return row;
}

/**
 * @param {import('./g3_e_wave_spec.js').G3EWaveSpec} spec
 * @param {string} batch_id
 * @param {string[]} expected_ids
 * @param {Record<string, string>} input_hash_by_id
 * @param {object} progress_doc
 */
export function load_g3_e_batch_agent_output(
  spec,
  batch_id,
  expected_ids,
  input_hash_by_id,
  progress_doc
) {
  const file_path = path.join(spec.agent_outputs_dir, batch_id + '-output.json');
  if (!fs.existsSync(file_path)) {
    throw new G3EAgentOutputMissingError('缺少 Agent 輸出：' + file_path);
  }

  const doc = JSON.parse(fs.readFileSync(file_path, 'utf8'));
  if (doc.batch_id !== batch_id) {
    throw new Error('batch_id 不符');
  }
  const tracks = doc.tracks || [];
  const by_id = {};
  for (let i = 0; i < tracks.length; i += 1) {
    by_id[tracks[i].track_id] = normalize_track_row(tracks[i]);
  }

  /** @type {object[]} */
  const loaded = [];
  for (let j = 0; j < expected_ids.length; j += 1) {
    const id = expected_ids[j];
    const input_hash = input_hash_by_id[id];
    const prev = progress_doc.tracks[id];

    if (
      prev &&
      prev.output_hash &&
      prev.input_hash === input_hash &&
      prev.validation_status === 'ok' &&
      prev.stage_status === 'staged'
    ) {
      loaded.push({
        track_id: id,
        row: null,
        skipped_resume: true,
        output_hash: prev.output_hash,
      });
      continue;
    }

    if (prev && prev.input_hash && prev.input_hash !== input_hash) {
      throw new Error(
        id + ' input_hash 已變更；需重新 Agent 推理，不可 silent 沿用舊 output'
      );
    }

    const row = by_id[id];
    if (!row) {
      throw new G3EAgentOutputMissingError(batch_id + ' 缺少 track_id ' + id);
    }
    if (row.source !== spec.agent_source) {
      throw new Error(id + ' source 須為 ' + spec.agent_source);
    }
    if (row.method !== spec.agent_method) {
      throw new Error(id + ' method 須為 ' + spec.agent_method);
    }

    const output_hash = stable_json_hash(row);
    loaded.push({
      track_id: id,
      row: row,
      skipped_resume: false,
      output_hash: output_hash,
    });
  }

  return { file_path: file_path, loaded: loaded, doc: doc };
}
