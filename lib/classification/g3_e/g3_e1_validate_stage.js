/**
 * G3-E.1 validate + stage（不 adopt）
 */
import { validate_g3_b_ai_draft } from '../g3_b/validate_ai_draft.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import fs from 'node:fs';
import { G3_E1_AGENT_SOURCE, G3_E1_AGENT_METHOD } from './paths_e1.js';
import { auto_review_ai_draft_with_quality } from '../g3_d/auto_review_quality.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';

const FORBIDDEN_METHODS = ['g3_d1_cursor_ai', 'g3_d1_evidence_classify'];

/**
 * @param {object[]} inferences
 * @param {string[]} track_ids
 */
export function validate_g3_e1_inferences(inferences, track_ids) {
  const ev = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks;
  validate_g3_b_ai_draft({ tracks: inferences }, { allowed_track_ids: track_ids, evidence_by_id: ev });

  const errors = [];
  for (let i = 0; i < inferences.length; i += 1) {
    const row = inferences[i];
    if (row.source !== G3_E1_AGENT_SOURCE) {
      errors.push('非法 source');
    }
    if (row.method !== G3_E1_AGENT_METHOD) {
      errors.push('非法 method');
    }
    if (FORBIDDEN_METHODS.indexOf(row.method) >= 0) {
      errors.push('規則 method 冒充');
    }
    if (row.provenance && row.provenance.model_api_session_id) {
      errors.push('不得虛構 session_id');
    }
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  /** @type {object[]} */
  const per_track = [];
  for (let j = 0; j < inferences.length; j += 1) {
    const r = inferences[j];
    const evt = ev[r.track_id];
    const rule = evt ? rule_classify_track(evt) : {};
    const review = auto_review_ai_draft_with_quality(evt, rule, r);
    per_track.push({
      track_id: r.track_id,
      validate_ok: true,
      quality_status: review.quality_status,
      structural_status: review.structural_status,
    });
  }

  return {
    schema_version: 1,
    validate_ok: true,
    track_count: inferences.length,
    per_track: per_track,
    stage_note_zh: '候選已 staged；adopt 本階段禁止',
  };
}
