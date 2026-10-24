/**
 * 預覽模式：決定是否納入智慧歌單預覽（不寫 confirmed）
 */
import {
  PREVIEW_MODE_STRICT,
  PREVIEW_MODE_BALANCED,
  PREVIEW_MODE_RELAXED,
} from './preview_settings.js';
import {
  FORMAL_CONFIRMED,
  FORMAL_AI_SUGGESTED,
  FORMAL_UNKNOWN,
  FORMAL_REJECTED,
} from './classification_state.js';
import { TIER_HIGH, TIER_MEDIUM, TIER_LOW } from './confidence_tier.js';
import { genre_profile_from_ai_candidate } from './genre_profile.js';

/**
 * @param {object} ctx
 * @param {string} mode
 */
export function evaluate_preview_inclusion(ctx, mode) {
  const formal = ctx.formal_state;
  const tier = ctx.confidence_tier || TIER_LOW;
  const m = mode || PREVIEW_MODE_BALANCED;

  if (formal === FORMAL_REJECTED) {
    return {
      included: false,
      reason: '已拒絕此版 AI 建議',
      risk_label: null,
      source: 'none',
    };
  }

  if (formal === FORMAL_CONFIRMED) {
    return {
      included: true,
      reason: '人工已確認',
      risk_label: null,
      source: 'confirmed',
      use_official: true,
    };
  }

  if (m === PREVIEW_MODE_STRICT) {
    return {
      included: false,
      reason: '嚴格模式僅採人工確認',
      risk_label: null,
      source: 'none',
    };
  }

  if (formal === FORMAL_AI_SUGGESTED) {
    if (m === PREVIEW_MODE_BALANCED) {
      if (tier === TIER_HIGH || tier === TIER_MEDIUM) {
        return {
          included: true,
          reason: '平衡模式：AI 未審核且可信度達標',
          risk_label: tier === TIER_MEDIUM ? '待確認（medium）' : null,
          source: 'ai_unreviewed',
          use_official: false,
        };
      }
      return {
        included: false,
        reason: '平衡模式：可信度不足',
        risk_label: null,
        source: 'none',
      };
    }
    if (m === PREVIEW_MODE_RELAXED) {
      return {
        included: true,
        reason: '寬鬆模式：納入 AI 推測',
        risk_label:
          tier === TIER_LOW ? '高風險：未確認' : '未人工確認',
        source: 'ai_unreviewed',
        use_official: false,
      };
    }
  }

  if (formal === FORMAL_UNKNOWN) {
    return {
      included: false,
      reason: '資料不足',
      risk_label: null,
      source: 'none',
    };
  }

  return {
    included: false,
    reason: '不符合預覽條件',
    risk_label: null,
    source: 'none',
  };
}

/**
 * @param {object} ctx
 */
export function effective_genre_profile_for_preview(ctx, inclusion) {
  if (!inclusion.included) {
    return null;
  }
  if (inclusion.use_official) {
    return ctx.index_genre_profile || null;
  }
  if (ctx.v2_candidate) {
    return genre_profile_from_ai_candidate(ctx.v2_candidate);
  }
  return ctx.index_genre_profile || null;
}

export function effective_tags_for_preview(ctx, inclusion) {
  if (!inclusion.included) {
    return null;
  }
  if (inclusion.use_official) {
    return ctx.index_tags || [];
  }
  return build_tags_from_candidate(ctx.v2_candidate, ctx.index_tags);
}

function build_tags_from_candidate(candidate, fallback_tags) {
  if (!candidate) {
    return fallback_tags || [];
  }
  const tags = [];
  if (candidate.language && candidate.language.value) {
    tags.push({
      dimension: 'language',
      value: candidate.language.value,
      source: 'ai_preview',
      confidence: candidate.language.confidence,
    });
  }
  const ctxs = candidate.contexts || candidate.moods || [];
  for (let i = 0; i < ctxs.length; i += 1) {
    tags.push({
      dimension: 'context',
      value: ctxs[i].value,
      source: 'ai_preview',
      confidence: ctxs[i].confidence,
    });
  }
  const decade_tag = (fallback_tags || []).find(function (t) {
    return t.dimension === 'decade';
  });
  if (decade_tag) {
    tags.push(decade_tag);
  }
  return tags;
}
