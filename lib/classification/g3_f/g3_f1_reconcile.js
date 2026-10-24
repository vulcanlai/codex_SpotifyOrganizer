/**
 * G3-F.1 全庫對帳（單遍 + 互斥狀態）
 */
import { resolve_human_confirmation } from '../g3_evidence/human_confirmation.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { auto_review_ai_draft_with_quality } from '../g3_d/auto_review_quality.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import { build_g3_f1_context } from './g3_f1_context.js';
import { is_qualified } from './g3_f1_reconcile_helpers.js';

/**
 * @param {object} [existing_ctx]
 * @returns {object}
 */
export function build_g3_f1_full_reconciliation(existing_ctx) {
  const ctx = existing_ctx || build_g3_f1_context();
  const overlap = {
    total_tracks: ctx.all_ids.length,
    identifiable_title_and_artist: 0,
    missing_required_metadata: 0,
    human_confirmed: 0,
    formal_classification_non_unknown: 0,
    has_qualified_ai_candidate: 0,
    has_e_or_f_ai_staged: 0,
    has_catalog_or_d34_ai: 0,
    has_reusable_legacy_only: 0,
    rule_only_non_unknown: 0,
    no_classification_candidate: 0,
    needs_evidence_on_best_ai: 0,
    has_conflict: 0,
    provenance_unverified_in_d5_pool: 0,
    wave_eligible_new_ai: 0,
  };

  /** @type {Record<string, number>} */
  const exclusive = {
    human_confirmed: 0,
    needs_data: 0,
    qualified_ai_or_reusable: 0,
    formal_state_only: 0,
    rule_only_no_qualified_ai: 0,
    awaiting_new_ai_inference: 0,
    metadata_stub_no_title: 0,
  };

  let d1_style_titled_complete = 0;
  let d1_style_needs_new_ai = 0;

  for (let i = 0; i < ctx.all_ids.length; i += 1) {
    const id = ctx.all_ids[i];
    const idx = ctx.index_by[id] || {};
    const ev = ctx.ev_tracks[id] || null;
    const title_ok =
      ev && ctx.helpers.has_valid_title(ev.identity && ev.identity.title);
    const artist_ok = ev && ctx.helpers.artists_identifiable(ev.identity && ev.identity.artists);
    const identifiable = title_ok && artist_ok;

    if (identifiable) {
      overlap.identifiable_title_and_artist += 1;
    } else {
      overlap.missing_required_metadata += 1;
    }

    const human = resolve_human_confirmation(id, {
      index_row: idx,
      overrides_doc: ctx.bundle.manual_overrides,
    });
    if (human.locked) {
      overlap.human_confirmed += 1;
    }

    const formal_row = ctx.formal_by[id];
    const formal_state = formal_row && formal_row.formal_state ? formal_row.formal_state : 'unknown';
    if (formal_state !== 'unknown') {
      overlap.formal_classification_non_unknown += 1;
    }

    const rule = ev ? rule_classify_track(ev) : { genre_profile: { primary_genre: GENRE_PRIMARY_UNKNOWN } };
    const rule_primary = (rule.genre_profile && rule.genre_profile.primary_genre) || GENRE_PRIMARY_UNKNOWN;
    const qualified = is_qualified(ctx, id, rule);

    if (qualified) {
      overlap.has_qualified_ai_candidate += 1;
      if (ctx.ai_staged_set.has(id)) {
        overlap.has_e_or_f_ai_staged += 1;
      }
      if (ctx.catalog.by_id[id] || ctx.d34_set.has(id)) {
        overlap.has_catalog_or_d34_ai += 1;
      }
      if (!ctx.qualified_set.has(id)) {
        overlap.has_reusable_legacy_only += 1;
      }
      const cat = ctx.catalog.by_id[id];
      const row_for_review = cat ? cat.row : null;
      if (row_for_review && ev) {
        const review = auto_review_ai_draft_with_quality(ev, rule, row_for_review);
        if (review.quality_status === 'needs_evidence') {
          overlap.needs_evidence_on_best_ai += 1;
        }
        if (review.structural_status === 'conflict') {
          overlap.has_conflict += 1;
        }
      }
    } else if (rule_primary !== GENRE_PRIMARY_UNKNOWN) {
      overlap.rule_only_non_unknown += 1;
    } else {
      overlap.no_classification_candidate += 1;
    }

    if (ctx.conflict_ids.has(id)) {
      overlap.has_conflict += 1;
    }
    if (ctx.d5_unverified.has(id)) {
      overlap.provenance_unverified_in_d5_pool += 1;
    }

    if (
      idx.metadata_status === 'complete' &&
      idx.display &&
      idx.display.name
    ) {
      d1_style_titled_complete += 1;
      if (!human.locked && !qualified && !ctx.catalog.by_id[id]) {
        d1_style_needs_new_ai += 1;
      }
    }

    const wave_eligible =
      identifiable &&
      !human.locked &&
      !qualified &&
      !ctx.e_wave_done.has(id) &&
      !ctx.d5_unverified.has(id);
    if (wave_eligible) {
      overlap.wave_eligible_new_ai += 1;
    }

    let bucket = 'metadata_stub_no_title';
    if (human.locked) {
      bucket = 'human_confirmed';
    } else if (!identifiable) {
      bucket = 'needs_data';
    } else if (qualified) {
      bucket = 'qualified_ai_or_reusable';
    } else if (formal_state !== 'unknown') {
      bucket = 'formal_state_only';
    } else if (rule_primary !== GENRE_PRIMARY_UNKNOWN) {
      bucket = 'rule_only_no_qualified_ai';
    } else {
      bucket = 'awaiting_new_ai_inference';
    }
    exclusive[bucket] += 1;
  }

  const exclusive_sum = Object.values(exclusive).reduce(function (a, b) {
    return a + b;
  }, 0);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    universe: {
      library_index_ids: ctx.all_ids.length,
      library_v2_index_ids: Object.keys(ctx.track_index).length,
    },
    overlap_flags: overlap,
    exclusive_primary_states: {
      counts: exclusive,
      sum_check: exclusive_sum,
      matches_universe: exclusive_sum === ctx.all_ids.length,
    },
    recalculated_reference: {
      d1_titled_metadata_complete: d1_style_titled_complete,
      d1_style_needs_new_ai_among_complete: d1_style_needs_new_ai,
      note_zh: '1,476 為舊快照；以上為本次自目前 JSON 重算，勿直接沿用舊估算',
    },
    evidence_fingerprint: ctx.evidence_fingerprint,
  };
}
