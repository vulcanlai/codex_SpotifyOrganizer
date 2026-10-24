/**
 * 情緒 inference／候選結構驗證（Phase 0）
 */
import { is_emotion_code } from './emotion_taxonomy.js';
import {
  EMOTION_AI_CONFIDENCE_VALUES,
  EMOTION_REVIEW_STATUS_VALUES,
  EVIDENCE_AXIS_NAMES,
  EVIDENCE_BASIS_VALUES,
  EMOTION_CANDIDATE_SCHEMA_VERSION,
} from './emotion_schema.js';
import {
  axis_basis_list,
  axis_summary_nonempty,
  FORBIDDEN_BASIS_EXPLICIT,
  label_claims_confirmed_sensory_without_proof,
  label_evidence_used_is_title_only,
  rhythmic_axis_violates_duration_rule,
  sonic_axis_violates_unverified_observation_rule,
} from './emotion_evidence_rules.js';
import {
  compute_emotion_label_tier,
  compute_emotion_track_tier,
} from './emotion_confidence_tier.js';

/**
 * @param {object} axis
 * @param {string} path_prefix
 * @param {string[]} errors
 */
function validate_evidence_axis(axis, path_prefix, errors) {
  if (axis == null) {
    return;
  }
  if (typeof axis !== 'object') {
    errors.push(path_prefix + ' 必須為物件');
    return;
  }
  if (axis.summary_zh != null && typeof axis.summary_zh !== 'string') {
    errors.push(path_prefix + '.summary_zh 必須為字串');
  }
  if (
    axis.confidence != null &&
    EMOTION_AI_CONFIDENCE_VALUES.indexOf(axis.confidence) < 0 &&
    axis.confidence !== 'confirmed'
  ) {
    errors.push(path_prefix + '.confidence 非法');
  }
  if (axis.confidence === 'confirmed') {
    errors.push(path_prefix + ' 不得使用 confirmed（僅人工複核後可標）');
  }
  const basis = axis_basis_list(axis);
  for (let i = 0; i < basis.length; i += 1) {
    if (basis[i] === FORBIDDEN_BASIS_EXPLICIT) {
      errors.push(path_prefix + '.basis 不得含 explicit');
    }
    if (EVIDENCE_BASIS_VALUES.indexOf(basis[i]) < 0) {
      errors.push(path_prefix + '.basis 含未知值：' + basis[i]);
    }
  }
  if (path_prefix.endsWith('rhythmic')) {
    if (rhythmic_axis_violates_duration_rule(axis)) {
      errors.push(path_prefix + ' 違反 duration_ms 規則（不可推算速度／BPM／情緒）');
    }
  }
  if (path_prefix.endsWith('sonic')) {
    if (sonic_axis_violates_unverified_observation_rule(axis)) {
      errors.push(path_prefix + ' 無音訊驗證時不得寫成實際聽感觀察');
    }
  }
}

/**
 * @param {object} label
 * @param {number} index
 */
function validate_emotion_label(label, index) {
  const errors = [];
  const prefix = 'emotion_labels[' + index + ']';
  if (!label || typeof label !== 'object') {
    return { ok: false, errors: [prefix + ' 必須為物件'] };
  }
  if (!is_emotion_code(label.code)) {
    errors.push(prefix + '.code 非法');
  }
  if (EMOTION_AI_CONFIDENCE_VALUES.indexOf(label.confidence) < 0) {
    if (label.confidence === 'confirmed') {
      errors.push(prefix + ' Agent 輸出不得 confidence=confirmed');
    } else {
      errors.push(prefix + '.confidence 必須為 inferred 或 unknown');
    }
  }
  if (
    label.review_status != null &&
    EMOTION_REVIEW_STATUS_VALUES.indexOf(label.review_status) < 0
  ) {
    errors.push(prefix + '.review_status 非法');
  }
  const axes = label.evidence_axes;
  if (axes != null && typeof axes !== 'object') {
    errors.push(prefix + '.evidence_axes 必須為物件');
  } else if (axes) {
    for (let a = 0; a < EVIDENCE_AXIS_NAMES.length; a += 1) {
      const name = EVIDENCE_AXIS_NAMES[a];
      validate_evidence_axis(axes[name], prefix + '.evidence_axes.' + name, errors);
    }
  }
  if (label_claims_confirmed_sensory_without_proof(label)) {
    errors.push(prefix + ' 宣稱已驗證聽感／歌詞但缺少對應 basis');
  }
  if (
    label.confidence === 'inferred' &&
    label_evidence_used_is_title_only(label.evidence_used || [])
  ) {
    const tier = compute_emotion_label_tier(label);
    if (tier !== 'none' && tier !== 'low') {
      errors.push(prefix + ' 僅弱線索（含歌名）不得 inferred 且無 low/none tier');
    }
    const has_strong = EVIDENCE_AXIS_NAMES.some(function (n) {
      const ax = (axes && axes[n]) || {};
      return axis_basis_list(ax).some(function (b) {
        return (
          b === 'direct_audio_feature' ||
          b === 'lyric_text_verified' ||
          b === 'human_listen_review'
        );
      });
    });
    if (!has_strong) {
      errors.push(prefix + ' 僅弱線索不得標記 inferred 情緒（應 unknown 或省略標籤）');
    }
  }
  if (label.confidence === 'inferred') {
    const any_axis = axes
      ? EVIDENCE_AXIS_NAMES.some(function (n) {
          return axis_summary_nonempty(axes[n]);
        })
      : false;
    if (!any_axis) {
      errors.push(prefix + ' confidence=inferred 時至少一軸需有 summary_zh');
    }
  }
  return { ok: errors.length === 0, errors: errors };
}

/**
 * @param {object} inference
 * @param {object} [opts]
 */
export function validate_emotion_inference(inference, opts) {
  const options = opts || {};
  const errors = [];
  const warnings = [];

  if (!inference || typeof inference !== 'object') {
    return {
      ok: false,
      errors: ['inference 必須為物件'],
      warnings: [],
      derived: null,
    };
  }
  if (!inference.track_id || typeof inference.track_id !== 'string') {
    errors.push('track_id 必填');
  }
  if (
    options.require_schema_version !== false &&
    inference.schema_version != null &&
    inference.schema_version !== EMOTION_CANDIDATE_SCHEMA_VERSION
  ) {
    errors.push('schema_version 不符 Phase 0');
  }

  const labels = inference.emotion_labels;
  if (labels == null) {
    errors.push('emotion_labels 必填（可為空陣列）');
  } else if (!Array.isArray(labels)) {
    errors.push('emotion_labels 必須為陣列');
  } else {
    const seen = {};
    for (let i = 0; i < labels.length; i += 1) {
      const v = validate_emotion_label(labels[i], i);
      if (!v.ok) {
        errors.push.apply(errors, v.errors);
      }
      const code = labels[i] && labels[i].code;
      if (code) {
        if (seen[code]) {
          errors.push('emotion_labels 重複 code：' + code);
        }
        seen[code] = true;
      }
    }
  }

  if (inference.genre_reference_readonly != null) {
    const gr = inference.genre_reference_readonly;
    if (typeof gr !== 'object') {
      errors.push('genre_reference_readonly 必須為物件');
    } else if (gr.primary_genre != null && typeof gr.primary_genre !== 'string') {
      errors.push('genre_reference_readonly.primary_genre 必須為字串');
    }
  }

  const derived = {
    emotion_track_tier: compute_emotion_track_tier(inference),
    label_tiers: [],
  };
  if (Array.isArray(labels)) {
    for (let j = 0; j < labels.length; j += 1) {
      derived.label_tiers.push({
        code: labels[j].code,
        tier: compute_emotion_label_tier(labels[j]),
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors: errors,
    warnings: warnings,
    derived: derived,
  };
}
