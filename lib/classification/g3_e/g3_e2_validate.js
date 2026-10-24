/**
 * G3-E.2 validate staged rows
 */
import fs from 'node:fs';
import { validate_g3_b_ai_draft } from '../g3_b/validate_ai_draft.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { auto_review_ai_draft_with_quality } from '../g3_d/auto_review_quality.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';

const FORBIDDEN_D1_REASONS = [
  'metadata／候選不足；保留 unknown 與未確認',
  '專輯或作曲者脈絡指向配樂／改編 instrumental；非 Spotify API',
  '作曲／專輯脈絡指向遊戲或影視配樂；器樂為主',
];

/**
 * @param {object[]} rows
 * @param {string[]} track_ids
 */
export function validate_g3_e2_agent_rows(rows, track_ids) {
  const ev = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks;
  validate_g3_b_ai_draft({ tracks: rows }, { allowed_track_ids: track_ids, evidence_by_id: ev });

  const reasons = {};
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (FORBIDDEN_D1_REASONS.indexOf(row.reason_zh) >= 0) {
      throw new Error(row.track_id + ' reason 為 D.1 模板');
    }
    const rz = row.reason_zh || '';
    if (reasons[rz] && rz.length > 18) {
      throw new Error('reason_zh 重複：' + row.track_id + ' vs ' + reasons[rz]);
    }
    if (rz) {
      reasons[rz] = row.track_id;
    }
  }

  /** @type {object[]} */
  const per_track = [];
  for (let j = 0; j < rows.length; j += 1) {
    const r = rows[j];
    const evt = ev[r.track_id];
    const rule = evt ? rule_classify_track(evt) : {};
    const review = auto_review_ai_draft_with_quality(evt, rule, r);
    per_track.push({
      track_id: r.track_id,
      quality_status: review.quality_status,
      structural_status: review.structural_status,
    });
  }

  return { validate_ok: true, per_track: per_track };
}
