/**
 * 情緒證據規則（Phase 0）：禁止假裝聽感／歌詞／節奏已確認
 */
import { WEAK_EVIDENCE_BASIS } from './emotion_schema.js';

/** explicit 不得作為任何軸的 basis 或推論依據 */
export const FORBIDDEN_BASIS_EXPLICIT = 'explicit';

/** 節奏軸：禁止由 duration 推 tempo／BPM／速度／情緒 */
export const RHYTHM_DURATION_FORBIDDEN_PATTERNS = [
  /\bbpm\b/i,
  /BPM/,
  /拍\s*\/\s*分/,
  /每分鐘\s*\d+\s*拍/,
  /曲長.*(快|慢|中速|速度)/,
  /duration_ms.*(快|慢|中板|快板|慢板)/i,
  /毫秒.*(推估|推算).*(快|慢|板)/,
  /(快板|慢板|中板|中速|急板|行板)/,
  /節奏.*(偏快|偏慢|急促)/,
];

/** 無音訊驗證時，sonic 軸禁止寫成實際聽感觀察 */
export const SONIC_UNVERIFIED_OBSERVATION_PATTERNS = [
  /編曲/,
  /配器/,
  /音色/,
  /混音/,
  /聽感/,
  /音域/,
  /和聲/,
  /小調/,
  /大調/,
  /調性/,
  /氛圍/,
  /壓迫感/,
  /空靈/,
  /低沉/,
  /高亢/,
  /柔和/,
  /激烈/,
  /電吉他/,
  /鋼琴/,
];

/** 僅弱線索 evidence_used 欄位名 */
export const WEAK_EVIDENCE_USED_FIELDS = new Set([
  'identity.title',
  'identity.artists',
  'identity.album_name',
  'genre_reference_readonly',
  'identity.explicit',
]);

/**
 * @param {string} text
 * @param {RegExp[]} patterns
 */
export function text_matches_any_pattern(text, patterns) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  for (let i = 0; i < patterns.length; i += 1) {
    if (patterns[i].test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {object} axis
 * @param {string} axis_name
 */
export function axis_summary_nonempty(axis) {
  if (!axis || typeof axis !== 'object') {
    return false;
  }
  const s = axis.summary_zh;
  return typeof s === 'string' && s.trim().length > 0;
}

/**
 * @param {object} axis
 */
export function axis_basis_list(axis) {
  if (!axis || !Array.isArray(axis.basis)) {
    return [];
  }
  return axis.basis.filter(function (b) {
    return typeof b === 'string' && b.length > 0;
  });
}

/**
 * @param {object} axis
 */
export function axis_has_only_weak_basis(axis) {
  const basis = axis_basis_list(axis);
  if (!basis.length) {
    return true;
  }
  for (let i = 0; i < basis.length; i += 1) {
    if (basis[i] === FORBIDDEN_BASIS_EXPLICIT) {
      return true;
    }
    if (!WEAK_EVIDENCE_BASIS.has(basis[i]) && basis[i] !== 'agent_inference_declared') {
      return false;
    }
  }
  return true;
}

/**
 * @param {object} label
 * @param {string[]} evidence_used
 */
export function label_evidence_used_is_title_only(evidence_used) {
  if (!evidence_used || !evidence_used.length) {
    return true;
  }
  for (let i = 0; i < evidence_used.length; i += 1) {
    const f = evidence_used[i];
    if (WEAK_EVIDENCE_USED_FIELDS.has(f)) {
      continue;
    }
    if (f === 'identity.duration_ms') {
      continue;
    }
    return false;
  }
  return evidence_used.some(function (f) {
    return f === 'identity.title';
  });
}

/**
 * 是否宣稱已確認聽感／歌詞（違規）
 * @param {object} label
 */
export function label_claims_confirmed_sensory_without_proof(label) {
  const axes = label.evidence_axes || {};
  const sonic = axes.sonic || {};
  const lyrical = axes.lyrical || {};
  if (sonic.direct_audio_verified === true) {
    const basis = axis_basis_list(sonic);
    const ok = basis.some(function (b) {
      return b === 'direct_audio_feature' || b === 'human_listen_review';
    });
    if (!ok) {
      return true;
    }
  }
  if (lyrical.lyric_text_available === true) {
    const basis = axis_basis_list(lyrical);
    if (!basis.includes('lyric_text_verified')) {
      return true;
    }
  }
  if (label.confidence === 'confirmed') {
    return true;
  }
  return false;
}

/**
 * @param {object} rhythmic_axis
 */
export function rhythmic_axis_violates_duration_rule(rhythmic_axis) {
  if (!axis_summary_nonempty(rhythmic_axis)) {
    return false;
  }
  const summary = rhythmic_axis.summary_zh || '';
  if (text_matches_any_pattern(summary, RHYTHM_DURATION_FORBIDDEN_PATTERNS)) {
    return true;
  }
  const basis = axis_basis_list(rhythmic_axis);
  const only_duration =
    basis.length === 1 && basis[0] === 'identity.duration_ms_fact_only';
  if (only_duration && summary.trim().length > 0) {
    const fact_only_ok = /不作|不推|無法|僅記錄曲長|只記錄/.test(summary);
    if (!fact_only_ok) {
      return true;
    }
  }
  if (
    basis.includes('identity.duration_ms_fact_only') &&
    text_matches_any_pattern(summary, RHYTHM_DURATION_FORBIDDEN_PATTERNS)
  ) {
    return true;
  }
  return false;
}

/**
 * @param {object} sonic_axis
 */
export function sonic_axis_violates_unverified_observation_rule(sonic_axis) {
  if (!axis_summary_nonempty(sonic_axis)) {
    return false;
  }
  if (sonic_axis.direct_audio_verified === true) {
    return false;
  }
  const summary = sonic_axis.summary_zh || '';
  return text_matches_any_pattern(summary, SONIC_UNVERIFIED_OBSERVATION_PATTERNS);
}

/**
 * @param {object} label
 */
export function label_has_actionable_emotion_without_evidence(label) {
  if (!label || !label.code) {
    return false;
  }
  const conf = label.confidence;
  if (conf === 'unknown') {
    return false;
  }
  const axes = label.evidence_axes || {};
  let any_axis_content = false;
  const names = ['sonic', 'lyrical', 'rhythmic'];
  for (let i = 0; i < names.length; i += 1) {
    if (axis_summary_nonempty(axes[names[i]])) {
      any_axis_content = true;
      break;
    }
  }
  if (!any_axis_content) {
    return true;
  }
  const sonic = axes.sonic || {};
  const rhythmic_ax = axes.rhythmic || {};
  if (sonic_axis_violates_unverified_observation_rule(sonic)) {
    return true;
  }
  if (rhythmic_axis_violates_duration_rule(rhythmic_ax)) {
    return true;
  }
  if (label_evidence_used_is_title_only(label.evidence_used || [])) {
    const has_strong = ['sonic', 'lyrical', 'rhythmic'].some(function (n) {
      const ax = axes[n] || {};
      return axis_basis_list(ax).some(function (b) {
        return (
          b === 'direct_audio_feature' ||
          b === 'lyric_text_verified' ||
          b === 'human_listen_review'
        );
      });
    });
    if (!has_strong) {
      return true;
    }
  }
  if (label_claims_confirmed_sensory_without_proof(label)) {
    return true;
  }
  const lyrical_ax = axes.lyrical || {};
  if (axis_summary_nonempty(lyrical_ax) && lyrical_ax.lyric_text_available !== true) {
    const basis = axis_basis_list(lyrical_ax);
    if (
      basis.length > 0 &&
      basis.every(function (b) {
        return WEAK_EVIDENCE_BASIS.has(b) || b === 'agent_inference_declared';
      })
    ) {
      return true;
    }
  }
  return false;
}
