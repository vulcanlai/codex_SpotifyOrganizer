/**
 * G3-D.1 智慧歌單預覽影響（離線）
 */
import fs from 'node:fs';
import { load_unified_classification_view } from '../g3_c/build_unified_view.js';
import { compute_g3_unified_playlist_preview } from '../g3_c/g3_smart_playlist_preview.js';
import { PREVIEW_MODE_BALANCED, PREVIEW_MODE_RELAXED } from '../preview_settings.js';
import { FILE_G3_D1_PREVIEW_IMPACT } from './paths_d1.js';
import { write_json_atomic } from '../../atomic_json.js';

/**
 * @param {{ before_doc?: object, after_doc?: object, write?: boolean }} [opts]
 */
export function compute_g3_d1_preview_impact(opts) {
  const options = opts || {};
  const after = options.after_doc || load_unified_classification_view();
  const write = options.write !== false;

  const balanced_after = compute_g3_unified_playlist_preview({}, PREVIEW_MODE_BALANCED, after);
  const relaxed_after = compute_g3_unified_playlist_preview({}, PREVIEW_MODE_RELAXED, after);

  let d1_in_balanced = 0;
  let d1_total_with_ai = 0;
  const sample200 = after.g3_d1_wave_200_count || 0;
  const ids = Object.keys(after.tracks || {});
  for (let i = 0; i < ids.length; i += 1) {
    const row = after.tracks[ids[i]];
    if (!row.in_g3_d1_wave_200) {
      continue;
    }
    if (row.classification_source === 'g3_d1_batch') {
      d1_total_with_ai += 1;
    }
    const prev = compute_g3_unified_playlist_preview({}, PREVIEW_MODE_BALANCED, after);
    /* per-track: use breakdown membership via re-filter — approximate via tier */
    if (
      row.title &&
      row.classification_source === 'g3_d1_batch' &&
      (row.ai_confidence_tier === 'high' ||
        row.ai_confidence_tier === 'medium' ||
        row.primary_genre.source_tier === 'human_confirmed')
    ) {
      d1_in_balanced += 1;
    }
  }

  const doc = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    wave_200_planned: sample200,
    d1_ai_imported_in_view: d1_total_with_ai,
    balanced_empty_filter_total: balanced_after.breakdown.total_unique,
    relaxed_empty_filter_total: relaxed_after.breakdown.total_unique,
    balanced_provenance: balanced_after.breakdown.by_provenance,
    d1_wave_estimated_in_balanced: d1_in_balanced,
    note_zh:
      'balanced 總數為全庫政策後結果；d1_wave 估計為 D.1 列且 high/medium tier 者（非精確集合 membership）',
  };

  if (write) {
    write_json_atomic(FILE_G3_D1_PREVIEW_IMPACT, doc);
  }

  return doc;
}
