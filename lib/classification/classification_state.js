/**
 * 正式分類狀態（與 ai-review 審核紀錄分開推導／快取）
 */
import { GENRE_PRIMARY_UNKNOWN } from './genre_taxonomy.js';
import {
  REVIEW_ACCEPTED,
  REVIEW_MODIFIED,
  REVIEW_REJECTED,
  REVIEW_PENDING,
} from './ai_review_store.js';

export const FORMAL_CONFIRMED = 'confirmed';
export const FORMAL_AI_SUGGESTED = 'ai_suggested';
export const FORMAL_UNKNOWN = 'unknown';
export const FORMAL_REJECTED = 'rejected';

export const FORMAL_STATE_VALUES = [
  FORMAL_CONFIRMED,
  FORMAL_AI_SUGGESTED,
  FORMAL_UNKNOWN,
  FORMAL_REJECTED,
];

function is_confirmed_override(override_row) {
  if (!override_row) {
    return false;
  }
  const src = override_row.source || '';
  if (src.indexOf('ai_review') >= 0 || src.indexOf('manual') >= 0) {
    return true;
  }
  return !!(override_row.genre_profile || override_row.language);
}

/**
 * @param {object} ctx
 */
export function resolve_formal_classification_state(ctx) {
  const override_row = ctx.override_row || null;
  const v2_review = ctx.v2_review || null;
  const v2_candidate = ctx.v2_candidate || null;
  const in_sample = ctx.in_ai_sample === true;

  const rev_status = v2_review && v2_review.status ? v2_review.status : REVIEW_PENDING;

  if (in_sample && rev_status === REVIEW_REJECTED) {
    return FORMAL_REJECTED;
  }

  if (is_confirmed_override(override_row)) {
    return FORMAL_CONFIRMED;
  }

  const g3_f_row = ctx.g3_f_registry_row || null;
  if (
    g3_f_row &&
    g3_f_row.status === 'adopted' &&
    g3_f_row.adopted_classification
  ) {
    return FORMAL_AI_SUGGESTED;
  }

  if (in_sample && (rev_status === REVIEW_ACCEPTED || rev_status === REVIEW_MODIFIED)) {
    return FORMAL_CONFIRMED;
  }

  if (in_sample && v2_candidate && rev_status === REVIEW_PENDING) {
    return FORMAL_AI_SUGGESTED;
  }

  const gp = ctx.index_genre_profile || null;
  if (gp && gp.primary_genre && gp.primary_genre !== GENRE_PRIMARY_UNKNOWN) {
    const manual = (ctx.index_tags || []).some(function (t) {
      return t.is_manual_override === true;
    });
    if (manual) {
      return FORMAL_CONFIRMED;
    }
  }

  if (gp?.primary_genre && gp.primary_genre !== GENRE_PRIMARY_UNKNOWN && ctx.index_full_library_inference?.source === 'codex_metadata_group_inference') {
    return FORMAL_AI_SUGGESTED;
  }
  return FORMAL_UNKNOWN;
}
