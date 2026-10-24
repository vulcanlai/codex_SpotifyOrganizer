/**
 * 通用：Agent 決策 JSON → agent-outputs（依 wave 路徑）
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../../atomic_json.js';
import { build_g3_f_paths } from './g3_f_paths_dynamic.js';

/**
 * @param {object} input_track
 * @param {object} decision
 * @param {object} paths build_g3_f_paths
 */
export function build_g3_f_agent_track_row(input_track, decision, paths) {
  const id = input_track.track_id;
  const title = input_track.identity && input_track.identity.title;
  return {
    track_id: id,
    title: title,
    source: paths.agent_source,
    method: paths.agent_method,
    confidence: 'inferred',
    confidence_tier: decision.confidence_tier || 'medium',
    human_locked: false,
    version_uncertainty: decision.version_uncertainty === true,
    genre_profile: {
      primary_genre: decision.primary_genre,
      subgenres: decision.subgenres || [],
      secondary_genres: decision.secondary_genres || [],
      confidence: 'inferred',
    },
    language: {
      value: decision.language || '未確認',
      confidence: decision.language_confidence || 'inferred',
      vocal_verification_status: decision.vocal_verification_status || 'unverified',
      evidence: decision.language_evidence || '',
    },
    contexts: (decision.contexts || []).map(function (c) {
      return { value: c, confidence: 'inferred' };
    }),
    special_types: decision.special_types || [],
    reason_zh: decision.reason_zh,
    evidence_used: decision.evidence_used || [
      'identity.title',
      'identity.artists',
      'identity.album_name',
    ],
    unverified_fields: decision.unverified_fields || [],
    provenance: {
      status: 'agent_workflow_declared',
      provenance_unverified: true,
      model_api_session_id: null,
      execution_method: 'cursor_ide_agent_json_batch',
    },
  };
}

/**
 * @param {number} wave_number
 * @param {Record<string, object>} decisions_by_id
 * @param {{ write?: boolean, wave_size?: number }} [opts]
 */
export function emit_g3_f_agent_outputs(wave_number, decisions_by_id, opts) {
  const options = opts || {};
  const write = options.write !== false;
  const paths = build_g3_f_paths(wave_number, options.wave_size || 100);
  const inputs = fs
    .readdirSync(paths.batch_inputs_dir)
    .filter(function (f) {
      return f.endsWith('-input.json');
    })
    .sort();

  /** @type {object[]} */
  const written = [];
  for (let i = 0; i < inputs.length; i += 1) {
    const in_path = path.join(paths.batch_inputs_dir, inputs[i]);
    const doc = JSON.parse(fs.readFileSync(in_path, 'utf8'));
    const batch_id = doc.batch_id;
    /** @type {object[]} */
    const tracks = [];
    for (let t = 0; t < doc.tracks.length; t += 1) {
      const inp = doc.tracks[t];
      const dec = decisions_by_id[inp.track_id];
      if (!dec) {
        throw new Error('缺少 Agent 決策：' + inp.track_id);
      }
      tracks.push(build_g3_f_agent_track_row(inp, dec, paths));
    }
    const out_doc = {
      schema_version: 1,
      batch_id: batch_id,
      source: paths.agent_source,
      model_note: 'G3-F.' + wave_number + ' ' + batch_id,
      tracks: tracks,
    };
    if (write) {
      fs.mkdirSync(paths.agent_outputs_dir, { recursive: true });
      write_json_atomic(
        path.join(paths.agent_outputs_dir, batch_id + '-output.json'),
        out_doc
      );
    }
    written.push({ batch_id: batch_id, track_count: tracks.length });
  }
  return { batches: written, wave_number: wave_number };
}

/**
 * 合併 wave 目錄下 agent-decisions-batch-*.json
 * @param {number} wave_number
 * @param {number} [wave_size]
 */
export function load_merged_agent_decisions_from_wave_dir(wave_number, wave_size) {
  const paths = build_g3_f_paths(wave_number, wave_size || 100);
  /** @type {Record<string, object>} */
  const merged = {};
  for (let i = 1; i <= 99; i += 1) {
    const num = String(i).padStart(2, '0');
    const p = path.join(paths.wave_dir, 'agent-decisions-batch-' + num + '.json');
    if (!fs.existsSync(p)) {
      if (i > 20) {
        break;
      }
      continue;
    }
    const batch = JSON.parse(fs.readFileSync(p, 'utf8'));
    const keys = Object.keys(batch);
    for (let k = 0; k < keys.length; k += 1) {
      merged[keys[k]] = batch[keys[k]];
    }
  }
  return merged;
}
