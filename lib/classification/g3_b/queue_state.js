/**
 * G3-B.2 分類佇列（以分類缺口為核心）
 */
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';

/** @typedef {'human_confirmed'|'not_classified'|'pending_ai'|'has_ai_suggestion'|'needs_data'|'needs_human'|'ai_attempted_still_unknown'} QueueState */

export const QUEUE_STATE = {
  HUMAN_CONFIRMED: 'human_confirmed',
  NOT_CLASSIFIED: 'not_classified',
  PENDING_AI: 'pending_ai',
  HAS_AI_SUGGESTION: 'has_ai_suggestion',
  NEEDS_DATA: 'needs_data',
  NEEDS_HUMAN: 'needs_human',
  AI_ATTEMPTED_STILL_UNKNOWN: 'ai_attempted_still_unknown',
};

/**
 * @param {object} rule_draft
 */
export function has_primary_genre_gap(rule_draft) {
  const gp = rule_draft.genre_profile || {};
  return !gp.primary_genre || gp.primary_genre === GENRE_PRIMARY_UNKNOWN;
}

/**
 * @param {object} rule_draft
 */
export function has_language_gap(rule_draft) {
  const lang = rule_draft.language || {};
  return !lang.value || lang.value === '未確認';
}

/**
 * @param {object} evidence_doc
 */
export function has_unadopted_ai_candidate(evidence_doc) {
  return (evidence_doc.classification_candidates || []).length > 0;
}

/**
 * @param {object} evidence_doc
 * @param {object} rule_draft
 * @param {{ g3b1_ai_row?: object, g3b2_processed_ids?: Record<string, boolean> }} [ctx]
 */
export function resolve_classification_queue_state(evidence_doc, rule_draft, ctx) {
  const options = ctx || {};
  const id = evidence_doc.track_id;

  if (evidence_doc.human_confirmation && evidence_doc.human_confirmation.locked) {
    return {
      queue_state: QUEUE_STATE.HUMAN_CONFIRMED,
      needs_ai_generation: false,
      ai_pending: false,
      reason_zh: '已人工確認，不進自動 AI 佇列',
    };
  }

  const primary_gap = has_primary_genre_gap(rule_draft);
  const language_gap = has_language_gap(rule_draft);
  const has_candidate = has_unadopted_ai_candidate(evidence_doc);
  const enrichment_ok = !!evidence_doc.identity.enrichment_cache_complete;
  const g3b1_row = options.g3b1_ai_row || null;
  const processed = options.g3b2_processed_ids && options.g3b2_processed_ids[id];

  if (!enrichment_ok && primary_gap && !has_candidate) {
    return {
      queue_state: QUEUE_STATE.NEEDS_DATA,
      needs_ai_generation: false,
      ai_pending: false,
      reason_zh: 'metadata／enrichment 不足且無 AI 候選，先補資料再分類',
    };
  }

  if (has_candidate) {
    const still_gap = primary_gap || language_gap;
    if (still_gap) {
      return {
        queue_state: QUEUE_STATE.HAS_AI_SUGGESTION,
        needs_ai_generation: false,
        ai_pending: false,
        reason_zh: '已有未採用 AI 候選，避免重複生成；待自動複核或正式採用',
      };
    }
  }

  if (g3b1_row && primary_gap && g3b1_row.genre_profile) {
    const ai_primary = g3b1_row.genre_profile.primary_genre;
    if (ai_primary && ai_primary !== GENRE_PRIMARY_UNKNOWN) {
      if (processed) {
        return {
          queue_state: QUEUE_STATE.AI_ATTEMPTED_STILL_UNKNOWN,
          needs_ai_generation: false,
          ai_pending: false,
          reason_zh: 'G3-B.1 已產生 AI 草稿但規則層仍 unknown；記錄後續可重試條件',
          retry_when: '人工修正規則或採用 AI 草稿後',
        };
      }
    }
  }

  if (primary_gap) {
    return {
      queue_state: QUEUE_STATE.PENDING_AI,
      needs_ai_generation: true,
      ai_pending: true,
      reason_zh: '主曲風仍 unknown，納入 AI 自動分類佇列（與 metadata 是否完整無關）',
    };
  }

  if (language_gap) {
    return {
      queue_state: QUEUE_STATE.PENDING_AI,
      needs_ai_generation: true,
      ai_pending: true,
      reason_zh: '主曲風已有推論但演唱語言未確認，納入 AI 補強佇列',
    };
  }

  if (rule_draft.classification_kind === 'unknown') {
    return {
      queue_state: QUEUE_STATE.NOT_CLASSIFIED,
      needs_ai_generation: true,
      ai_pending: true,
      reason_zh: '規則層未分類',
    };
  }

  return {
    queue_state: QUEUE_STATE.NOT_CLASSIFIED,
    needs_ai_generation: false,
    ai_pending: false,
    reason_zh: '規則草稿已有主曲風與語言欄位（或預設），無需排入新 AI 生成',
  };
}

/**
 * 舊版 should_ai_pending 相容：等同 needs_ai_generation
 * @param {object} evidence_doc
 * @param {object} rule_draft
 * @param {object} [ctx]
 */
export function should_ai_pending(evidence_doc, rule_draft, ctx) {
  const q = resolve_classification_queue_state(evidence_doc, rule_draft, ctx);
  return q.ai_pending === true;
}
