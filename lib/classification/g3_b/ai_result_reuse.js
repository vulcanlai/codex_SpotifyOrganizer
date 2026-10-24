/**
 * AI 分類結果重用判定（不自動升級 confirmed）
 */
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import { GENRE_TAXONOMY_VERSION } from '../paths.js';
import { has_primary_genre_gap } from './queue_state.js';

const SOURCE_PRIORITY = {
  g3_b1_ai_draft: 3,
  'v2-30': 2,
  'phase-e-100': 1,
};

/**
 * @param {object[]} records
 */
export function pick_best_reusable_record(records) {
  const usable = (records || []).filter(function (r) {
    return r.reusable !== false && !r.regen_required;
  });
  if (!usable.length) {
    return null;
  }
  usable.sort(function (a, b) {
    const pa = SOURCE_PRIORITY[a.source] || 0;
    const pb = SOURCE_PRIORITY[b.source] || 0;
    return pb - pa;
  });
  return usable[0];
}

/**
 * @param {object} best
 * @param {object} rule_draft
 */
export function covers_primary_genre_gap(best, rule_draft) {
  if (!best) {
    return false;
  }
  if (!has_primary_genre_gap(rule_draft)) {
    return true;
  }
  return best.primary_genre && best.primary_genre !== GENRE_PRIMARY_UNKNOWN;
}

/**
 * @param {object} ctx
 */
export function should_regenerate(ctx) {
  const options = ctx || {};
  if (options.force_regen) {
    return { regen: true, reason: options.force_regen_reason || 'explicit_regen' };
  }
  if (options.taxonomy_version != null && options.taxonomy_version !== GENRE_TAXONOMY_VERSION) {
    return { regen: true, reason: 'taxonomy_version_changed' };
  }
  if (
    options.stored_evidence_fingerprint &&
    options.current_evidence_fingerprint &&
    options.stored_evidence_fingerprint !== options.current_evidence_fingerprint
  ) {
    return { regen: true, reason: 'evidence_fingerprint_changed' };
  }
  if (options.prior_invalid) {
    return { regen: true, reason: 'prior_result_marked_invalid' };
  }
  return { regen: false, reason: null };
}

/**
 * @param {string} track_id
 * @param {object} inv_entry inventory per_track item
 * @param {object} rule_draft
 * @param {object} opts
 */
export function resolve_reuse_for_track(track_id, inv_entry, rule_draft, opts) {
  const options = opts || {};
  const records = inv_entry.records || [];
  const best = pick_best_reusable_record(records);
  const regen = should_regenerate({
    force_regen: options.force_regen,
    stored_evidence_fingerprint: best && best.evidence_fingerprint,
    current_evidence_fingerprint: options.evidence_fingerprint,
    prior_invalid: best && best.review_status === 'conflict' && options.treat_conflict_as_regen,
  });

  const covers = covers_primary_genre_gap(best, rule_draft);
  const reusable = !!best && !regen.regen && covers;

  return {
    track_id: track_id,
    best_record: best,
    all_sources: records.map(function (r) {
      return r.source;
    }),
    reusable: reusable,
    regen_required: regen.regen || (!covers && has_primary_genre_gap(rule_draft)),
    regen_reason: regen.regen
      ? regen.reason
      : !covers && has_primary_genre_gap(rule_draft)
        ? 'primary_genre_still_unknown'
        : null,
    duplicate_sources_count: records.length,
  };
}
