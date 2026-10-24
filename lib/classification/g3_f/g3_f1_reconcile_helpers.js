/**
 * G3-F.1 合格候選判定（reconcile / queue 共用）
 */
import { resolve_reuse_for_track } from '../g3_b/ai_result_reuse.js';
import { validate_genre_profile_draft } from '../g3_b/rule_classify.js';
import { SUBGENRES_BY_CODE } from '../genre_taxonomy.js';

function reuse_qualifies(best) {
  if (!best) {
    return false;
  }
  const gp = {
    primary_genre: best.primary_genre,
    subgenres: best.subgenres || [],
    secondary_genres: best.secondary_genres || [],
    confidence: 'inferred',
  };
  if (!validate_genre_profile_draft(gp)) {
    return false;
  }
  const subs = gp.subgenres || [];
  for (let s = 0; s < subs.length; s += 1) {
    const code = subs[s];
    if (!SUBGENRES_BY_CODE[code]) {
      return false;
    }
    if (gp.primary_genre !== 'unknown' && SUBGENRES_BY_CODE[code].main !== gp.primary_genre) {
      return false;
    }
  }
  return true;
}

/**
 * @param {object} ctx
 * @param {string} id
 * @param {object} rule
 */
export function is_qualified(ctx, id, rule) {
  if (ctx.qualified_set.has(id)) {
    return true;
  }
  const inv = ctx.inv_by_id.get(id);
  const reuse = resolve_reuse_for_track(id, inv || { records: [] }, rule, {
    evidence_fingerprint: ctx.evidence_fingerprint,
  });
  return reuse.reusable && reuse_qualifies(reuse.best_record);
}
