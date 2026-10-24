/**
 * G3-C 統一檢視：D.1 規則式 vs 真正 Cursor Agent 來源區分
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { build_d1_lineage_200 } from './g3_d3_lineage.js';
import {
  FILE_G3_D4_INFERENCE_OVERLAY,
  G3_D4_WAVE_DIR,
  G3_D4_AGENT_SOURCE,
} from './paths_d4.js';
import {
  SOURCE_TIER_AI,
  SOURCE_TIER_RULE,
  SOURCE_TIER_UNKNOWN,
} from '../g3_c/paths_c1.js';

/** @type {Record<string, string>|null} */
let cached_lineage_kind = null;

function load_lineage_kind_map() {
  if (cached_lineage_kind) {
    return cached_lineage_kind;
  }
  const lin = build_d1_lineage_200();
  /** @type {Record<string, string>} */
  const map = {};
  for (let i = 0; i < lin.tracks.length; i += 1) {
    map[lin.tracks[i].track_id] = lin.tracks[i].inference_source_kind;
  }
  cached_lineage_kind = map;
  return map;
}

/**
 * @param {string} track_id
 * @param {{ row: object, source: string }|null} ai_pack
 */
export function resolve_effective_inference_for_unified_view(track_id, ai_pack) {
  if (!ai_pack) {
    return {
      display_tier: SOURCE_TIER_UNKNOWN,
      display_detail: 'no_ai_catalog_row',
      inference_source_kind: 'none',
      is_cursor_agent_ai: false,
    };
  }

  const row = ai_pack.row || {};
  const row_source = row.source || row.inference_source || null;
  if (
    row_source === 'cursor_agent_g3_d3_repair' ||
    row_source === G3_D4_AGENT_SOURCE ||
    row.method === 'g3_d3_cursor_agent' ||
    row.method === 'g3_d4_cursor_agent'
  ) {
    return {
      display_tier: SOURCE_TIER_AI,
      display_detail: row_source || ai_pack.source,
      inference_source_kind: 'cursor_agent_actual_ai',
      is_cursor_agent_ai: true,
    };
  }

  if (ai_pack.source === 'g3_d1_batch') {
    const kind_map = load_lineage_kind_map();
    const kind = kind_map[track_id] || 'rule_heuristic_unknown';
    const is_agent = kind === 'cursor_agent_actual_ai';
    return {
      display_tier: is_agent ? SOURCE_TIER_AI : SOURCE_TIER_RULE,
      display_detail: is_agent ? 'g3_d1_cursor_agent' : 'g3_d1_rule_evidence_classify:' + kind,
      inference_source_kind: kind,
      is_cursor_agent_ai: is_agent,
    };
  }

  return {
    display_tier: SOURCE_TIER_AI,
    display_detail: ai_pack.source,
    inference_source_kind: 'g3_b_ai_catalog',
    is_cursor_agent_ai: row_source && String(row_source).indexOf('cursor_agent') >= 0,
  };
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function build_d4_inference_source_overlay_v2(opts) {
  const options = opts || {};
  const write = options.write === true;
  const lin = build_d1_lineage_200();
  const doc = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    note_zh:
      '修正 G3-C 顯示：g3_d1_batch 依 lineage 標為 rule_inference；D.3/D.4 cursor_agent 標為 ai_suggestion',
    d1_lineage_counts: lin.counts,
    tracks: lin.tracks.map(function (t) {
      return {
        track_id: t.track_id,
        d1_import_label: 'g3_d1_batch',
        inference_source_kind: t.inference_source_kind,
        unified_display_tier:
          t.inference_source_kind === 'cursor_agent_actual_ai'
            ? SOURCE_TIER_AI
            : SOURCE_TIER_RULE,
        must_not_label_as_cursor_agent:
          t.inference_source_kind !== 'cursor_agent_actual_ai',
      };
    }),
  };
  if (write) {
    if (!fs.existsSync(G3_D4_WAVE_DIR)) {
      fs.mkdirSync(G3_D4_WAVE_DIR, { recursive: true });
    }
    write_json_atomic(FILE_G3_D4_INFERENCE_OVERLAY, doc);
  }
  return doc;
}
