/**
 * G3-D.4 Agent 批次驗證（含反規則冒充檢查）
 */
import { validate_g3_b_ai_draft } from '../g3_b/validate_ai_draft.js';
import {
  G3_D4_AGENT_SOURCE,
  G3_D4_AGENT_METHOD,
} from './paths_d4.js';

const FORBIDDEN_D1_REASONS = [
  'metadata／候選不足；保留 unknown 與未確認',
  '專輯或作曲者脈絡指向配樂／改編 instrumental；非 Spotify API',
  '作曲／專輯脈絡指向遊戲或影視配樂；器樂為主',
];

const FORBIDDEN_METHODS = ['g3_d1_cursor_ai', 'g3_d1_evidence_classify'];

/**
 * @param {object} doc batch draft json
 * @param {string[]} allowed_track_ids
 * @param {Record<string, object>} evidence_by_id
 */
export function validate_g3_d4_agent_batch(doc, allowed_track_ids, evidence_by_id) {
  validate_g3_b_ai_draft(doc, {
    allowed_track_ids: allowed_track_ids,
    evidence_by_id: evidence_by_id,
  });

  const errors = [];
  const tracks = doc.tracks || [];
  const reasons = {};

  for (let i = 0; i < tracks.length; i += 1) {
    const row = tracks[i];
    if (row.source !== G3_D4_AGENT_SOURCE) {
      errors.push(row.track_id + ' source 必須為 ' + G3_D4_AGENT_SOURCE);
    }
    if (row.method && row.method !== G3_D4_AGENT_METHOD) {
      errors.push(row.track_id + ' method 非法');
    }
    if (row.inference_source && row.inference_source !== G3_D4_AGENT_SOURCE) {
      errors.push(row.track_id + ' inference_source 不一致');
    }
    if (FORBIDDEN_METHODS.indexOf(row.method) >= 0) {
      errors.push(row.track_id + ' 不得使用 D.1 規則 method');
    }
    const rz = row.reason_zh || '';
    if (FORBIDDEN_D1_REASONS.indexOf(rz) >= 0) {
      errors.push(row.track_id + ' reason_zh 與 D.1 模板相同（疑似規則冒充）');
    }
    if (reasons[rz] && rz.length > 8) {
      errors.push(row.track_id + ' 與 ' + reasons[rz] + ' reason_zh 重複');
    }
    if (rz) {
      reasons[rz] = row.track_id;
    }
  }

  if (errors.length) {
    const err = new Error(errors.join('\n'));
    err.name = 'G3D4ValidateError';
    throw err;
  }

  return { valid_count: tracks.length };
}
