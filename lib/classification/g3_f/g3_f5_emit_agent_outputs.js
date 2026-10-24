/**
 * 將 Agent 分類決策（JSON）與 batch input 合併為 g3f5-batch-XX-output.json
 * 決策內容須由 Cursor Agent 提供，本模組僅做 schema 包裝。
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../../atomic_json.js';
import {
  G3_F5_AGENT_OUTPUTS_DIR,
  G3_F5_BATCH_INPUTS_DIR,
  G3_F5_AGENT_SOURCE,
  G3_F5_AGENT_METHOD,
} from './paths_f5.js';

/**
 * @param {object} input_track
 * @param {object} decision
 */
export function build_g3_f5_agent_track_row(input_track, decision) {
  const id = input_track.track_id;
  const title = input_track.identity && input_track.identity.title;
  return {
    track_id: id,
    title: title,
    source: G3_F5_AGENT_SOURCE,
    method: G3_F5_AGENT_METHOD,
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
 * @param {Record<string, object>} decisions_by_id
 * @param {{ write?: boolean }} [opts]
 */
export function emit_g3_f5_agent_outputs(decisions_by_id, opts) {
  const options = opts || {};
  const write = options.write !== false;
  const inputs = fs
    .readdirSync(G3_F5_BATCH_INPUTS_DIR)
    .filter(function (f) {
      return f.endsWith('-input.json');
    })
    .sort();

  /** @type {object[]} */
  const written = [];
  for (let i = 0; i < inputs.length; i += 1) {
    const in_path = path.join(G3_F5_BATCH_INPUTS_DIR, inputs[i]);
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
      tracks.push(build_g3_f5_agent_track_row(inp, dec));
    }
    const out_doc = {
      schema_version: 1,
      batch_id: batch_id,
      source: G3_F5_AGENT_SOURCE,
      model_note: 'G3-F.5 ' + batch_id,
      tracks: tracks,
    };
    if (write) {
      fs.mkdirSync(G3_F5_AGENT_OUTPUTS_DIR, { recursive: true });
      write_json_atomic(
        path.join(G3_F5_AGENT_OUTPUTS_DIR, batch_id + '-output.json'),
        out_doc
      );
    }
    written.push({ batch_id: batch_id, track_count: tracks.length });
  }
  return { batches: written };
}
