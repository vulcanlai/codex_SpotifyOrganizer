/**
 * G3-D.4 批次品質檢查
 */
import { auto_review_ai_draft_with_quality } from './auto_review_quality.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';

function has_instrumental_tag(row) {
  const specs = row.special_types || [];
  for (let i = 0; i < specs.length; i += 1) {
    const v = specs[i].value || specs[i];
    if (v === '純音樂') {
      return true;
    }
  }
  return false;
}

function reason_uniqueness_ratio(rows) {
  const seen = {};
  let dup = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i].reason_zh || '';
    if (r.length < 12) {
      continue;
    }
    if (seen[r]) {
      dup += 1;
    }
    seen[r] = true;
  }
  return { duplicate_reason_count: dup, track_count: rows.length };
}

/**
 * @param {object[]} agent_rows
 * @param {Record<string, object>} ev_by_id
 * @param {{ checkpoint_label: string, through_batch: number }} meta
 */
export function run_g3_d4_quality_checkpoint(agent_rows, ev_by_id, meta) {
  const n = agent_rows.length;
  let unknown_pk = 0;
  let soundtrack = 0;
  let instrumental_tag = 0;
  let low_tier = 0;
  let needs_evidence = 0;
  let classification_unknown = 0;

  for (let i = 0; i < n; i += 1) {
    const row = agent_rows[i];
    const pk = row.genre_profile.primary_genre;
    if (pk === GENRE_PRIMARY_UNKNOWN || pk === 'unknown') {
      unknown_pk += 1;
    }
    if (pk === 'soundtrack_instrumental') {
      soundtrack += 1;
    }
    if (has_instrumental_tag(row)) {
      instrumental_tag += 1;
    }
    if (row.confidence_tier === 'low') {
      low_tier += 1;
    }
    const ev = ev_by_id[row.track_id];
    const rule = ev ? rule_classify_track(ev) : {};
    const review = auto_review_ai_draft_with_quality(ev, rule, row);
    if (review.quality_status === 'needs_evidence') {
      needs_evidence += 1;
    }
    if (review.quality_status === 'classification_unknown') {
      classification_unknown += 1;
    }
  }

  const uniq = reason_uniqueness_ratio(agent_rows);
  const ratios = {
    unknown_primary_ratio: n ? unknown_pk / n : 0,
    soundtrack_ratio: n ? soundtrack / n : 0,
    instrumental_tag_ratio: n ? instrumental_tag / n : 0,
    low_tier_ratio: n ? low_tier / n : 0,
    needs_evidence_ratio: n ? needs_evidence / n : 0,
  };

  const flags = [];
  if (ratios.unknown_primary_ratio > 0.45) {
    flags.push('unknown 主曲風比例過高');
  }
  if (ratios.soundtrack_ratio > 0.55) {
    flags.push('soundtrack_instrumental 比例過高');
  }
  if (ratios.instrumental_tag_ratio > 0.35) {
    flags.push('「純音樂」標籤比例過高');
  }
  if (uniq.duplicate_reason_count > Math.max(2, Math.floor(n * 0.08))) {
    flags.push('reason_zh 重複過多（疑似模板化）');
  }

  const pass = flags.length === 0;

  return {
    checkpoint_label: meta.checkpoint_label,
    through_batch: meta.through_batch,
    track_count: n,
    counts: {
      unknown_primary: unknown_pk,
      soundtrack_instrumental: soundtrack,
      instrumental_tag: instrumental_tag,
      low_tier: low_tier,
      needs_evidence: needs_evidence,
      classification_unknown_quality: classification_unknown,
    },
    ratios: ratios,
    reason_uniqueness: uniq,
    systemic_flags_zh: flags,
    pass: pass,
  };
}
