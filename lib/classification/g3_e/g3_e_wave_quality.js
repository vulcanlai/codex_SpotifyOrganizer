/**
 * G3-E 批次／里程碑品質
 */
import fs from 'node:fs';
import { run_g3_e2_batch_quality } from './g3_e2_quality.js';
import { FILE_G3_D4_MERGED_CANDIDATE_200 } from '../g3_d/paths_d4.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { auto_review_ai_draft_with_quality } from '../g3_d/auto_review_quality.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';

export { run_g3_e2_batch_quality as run_g3_e_batch_quality };

function load_d34_by_id() {
  const merged = JSON.parse(fs.readFileSync(FILE_G3_D4_MERGED_CANDIDATE_200, 'utf8'));
  /** @type {Record<string, object>} */
  const by = {};
  for (let m = 0; m < merged.tracks.length; m += 1) {
    by[merged.tracks[m].track_id] = merged.tracks[m];
  }
  return by;
}

/**
 * @param {object[]} rows
 * @param {string} milestone_id
 */
export function run_g3_e_milestone_quality(rows, milestone_id) {
  const d34_by = load_d34_by_id();
  const ev_all = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};
  const n = rows.length;
  let d34_match = 0;
  let needs_evidence = 0;
  let conflict = 0;
  const tier_counts = { low: 0, medium: 0, high: 0, other: 0 };

  for (let i = 0; i < n; i += 1) {
    const row = rows[i];
    const id = row.track_id;
    const d34 = d34_by[id];
    if (d34 && d34.genre_profile.primary_genre === row.genre_profile.primary_genre) {
      d34_match += 1;
    }
    const tier = row.confidence_tier || 'other';
    if (tier_counts[tier] !== undefined) {
      tier_counts[tier] += 1;
    } else {
      tier_counts.other += 1;
    }
    const ev = ev_all[id];
    const rule = ev ? rule_classify_track(ev) : {};
    const review = auto_review_ai_draft_with_quality(ev, rule, row);
    if (review.quality_status === 'needs_evidence') {
      needs_evidence += 1;
    }
    if (review.structural_status === 'conflict') {
      conflict += 1;
    }
  }

  const batch_qc = run_g3_e2_batch_quality(rows, milestone_id, {});
  const flags = batch_qc.systemic_flags_zh.slice();
  if (n >= 10 && d34_match / n > 0.95) {
    flags.push('與 D.3/D.4 主曲風一致比例過高（>95%）— 請確認 infer 未沿用舊 AI');
  }

  return {
    milestone_id: milestone_id,
    track_count: n,
    d34_primary_match_ratio: n ? d34_match / n : 0,
    confidence_tier_counts: tier_counts,
    needs_evidence_count: needs_evidence,
    conflict_count: conflict,
    batch_style_metrics: batch_qc,
    systemic_flags_zh: flags,
    pass: flags.length === 0,
  };
}
