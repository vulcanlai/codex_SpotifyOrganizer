/**
 * 情緒專用 confidence tier（規則推導，非 AI 自報）
 * 不沿用 G3-F 主曲風 evidence 錨定歌名規則。
 */
import {
  axis_basis_list,
  axis_has_only_weak_basis,
  axis_summary_nonempty,
  label_evidence_used_is_title_only,
} from './emotion_evidence_rules.js';
import { STRONG_EVIDENCE_BASIS } from './emotion_schema.js';

export const EMOTION_TIER_HIGH = 'high';
export const EMOTION_TIER_MEDIUM = 'medium';
export const EMOTION_TIER_LOW = 'low';
export const EMOTION_TIER_NONE = 'none';

export const EMOTION_TIER_VALUES = [
  EMOTION_TIER_HIGH,
  EMOTION_TIER_MEDIUM,
  EMOTION_TIER_LOW,
  EMOTION_TIER_NONE,
];

/**
 * @param {object} axis
 */
function axis_has_strong_basis(axis) {
  const basis = axis_basis_list(axis);
  for (let i = 0; i < basis.length; i += 1) {
    if (STRONG_EVIDENCE_BASIS.has(basis[i])) {
      return true;
    }
  }
  return false;
}

/**
 * 單一 emotion 標籤 tier
 * @param {object} label
 */
export function compute_emotion_label_tier(label) {
  if (!label || !label.code) {
    return EMOTION_TIER_NONE;
  }
  if (label.confidence === 'unknown') {
    return EMOTION_TIER_NONE;
  }

  const axes = label.evidence_axes || {};
  const sonic = axes.sonic || {};
  const lyrical = axes.lyrical || {};
  const rhythmic = axes.rhythmic || {};

  const strong_axes = [sonic, lyrical, rhythmic].filter(function (ax) {
    return axis_has_strong_basis(ax) && axis_summary_nonempty(ax);
  }).length;

  const any_axis_text = [sonic, lyrical, rhythmic].some(axis_summary_nonempty);

  if (strong_axes >= 1) {
    if (sonic.direct_audio_verified === true || lyrical.lyric_text_available === true) {
      return EMOTION_TIER_HIGH;
    }
    return EMOTION_TIER_MEDIUM;
  }

  if (!any_axis_text) {
    return EMOTION_TIER_NONE;
  }

  const only_weak = [sonic, lyrical, rhythmic].every(function (ax) {
    if (!axis_summary_nonempty(ax)) {
      return true;
    }
    return axis_has_only_weak_basis(ax);
  });

  if (only_weak || label_evidence_used_is_title_only(label.evidence_used || [])) {
    return EMOTION_TIER_LOW;
  }

  return EMOTION_TIER_MEDIUM;
}

/**
 * 整首 inference 的彙總 tier（取標籤最高，無標籤則 none）
 * @param {object} inference
 */
export function compute_emotion_track_tier(inference) {
  const labels = (inference && inference.emotion_labels) || [];
  if (!labels.length) {
    return EMOTION_TIER_NONE;
  }
  const rank = {};
  rank[EMOTION_TIER_NONE] = 0;
  rank[EMOTION_TIER_LOW] = 1;
  rank[EMOTION_TIER_MEDIUM] = 2;
  rank[EMOTION_TIER_HIGH] = 3;

  let best = EMOTION_TIER_NONE;
  for (let i = 0; i < labels.length; i += 1) {
    const t = compute_emotion_label_tier(labels[i]);
    if (rank[t] > rank[best]) {
      best = t;
    }
  }
  return best;
}
