/**
 * G3-F.1 待分類佇列
 */
import { resolve_human_confirmation } from '../g3_evidence/human_confirmation.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { resolve_reuse_for_track } from '../g3_b/ai_result_reuse.js';
import { build_stratify_row } from '../g3_b/g3_b5_stratify.js';
import { build_g3_f1_context } from './g3_f1_context.js';
import { is_qualified } from './g3_f1_reconcile_helpers.js';
import { load_prior_g3_f_wave_track_ids } from './g3_f_prior_waves.js';

/**
 * @param {object} [ctx]
 * @param {{ exclude_prior_f_waves?: boolean }} [opts]
 * @returns {object}
 */
export function build_g3_f1_pending_queue(ctx, opts) {
  const context = ctx || build_g3_f1_context();
  const options = opts || {};
  const exclude_f = options.exclude_prior_f_waves !== false;
  const prior_f = exclude_f ? load_prior_g3_f_wave_track_ids() : { ids: new Set(), waves: [] };
  let excluded_prior_f_count = 0;
  /** @type {object[]} */
  const pending = [];
  /** @type {object[]} */
  const needs_data = [];

  for (let i = 0; i < context.identifiable_ids.length; i += 1) {
    const id = context.identifiable_ids[i];
    const ev = context.ev_tracks[id];
    const idx = context.index_by[id] || {};
    const human = resolve_human_confirmation(id, {
      index_row: idx,
      overrides_doc: context.bundle.manual_overrides,
    });
    const rule = rule_classify_track(ev);

    if (human.locked) {
      continue;
    }
    if (context.e_wave_done.has(id)) {
      continue;
    }
    if (context.d5_unverified.has(id)) {
      continue;
    }
    if (is_qualified(context, id, rule)) {
      continue;
    }
    if (prior_f.ids.has(id)) {
      excluded_prior_f_count += 1;
      continue;
    }

    const row = build_stratify_row(id, ev, idx);
    const rule_primary = (rule.genre_profile && rule.genre_profile.primary_genre) || 'unknown';
    pending.push(
      Object.assign({}, row, {
        diversity_rule_primary_hint: rule_primary,
        queue_reason_zh: '可辨識曲名＋藝人；無合格 AI；非 E 波／D.5 unverified 140',
      })
    );
  }

  for (let j = 0; j < context.all_ids.length; j += 1) {
    const id = context.all_ids[j];
    const ev = context.ev_tracks[id];
    const idx = context.index_by[id] || {};
    const title_ok =
      ev && context.helpers.has_valid_title(ev.identity && ev.identity.title);
    const artist_ok = ev && context.helpers.artists_identifiable(ev.identity && ev.identity.artists);
    if (!title_ok || !artist_ok) {
      needs_data.push({
        track_id: id,
        reason_zh: !title_ok ? '缺少可辨識曲名' : '缺少可辨識藝人',
        metadata_status: idx.metadata_status || null,
      });
    }
  }

  pending.sort(function (a, b) {
    return a.track_id < b.track_id ? -1 : 1;
  });

  return {
    schema_version: 1,
    pending_count: pending.length,
    needs_data_count: needs_data.length,
    pending_tracks: pending,
    needs_data_sample: needs_data.slice(0, 20),
    filters_applied_zh: [
      'evidence 曲名＋藝人',
      '排除 human_locked',
      '排除 E.1/E.2/E.3 已完成',
      '排除 D.5 provenance_unverified 140',
      '排除 catalog／D34／可重用合格 AI',
      exclude_f ? '排除已完成 G3-F wave 曲目' : null,
    ].filter(Boolean),
    excluded_prior_f_waves: prior_f.waves,
    excluded_prior_f_wave_track_count: excluded_prior_f_count,
  };
}
