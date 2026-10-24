/**
 * G3-D.4 可回復採用 overlay 方案（本階段不啟用）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { load_unified_classification_view } from '../g3_c/build_unified_view.js';
import { compute_g3_unified_playlist_preview } from '../g3_c/g3_smart_playlist_preview.js';
import {
  FILE_G3_D4_ADOPT_SCHEME,
  FILE_G3_D4_ADOPT_OVERLAY,
  FILE_G3_D4_ADOPT_SIMULATION,
  G3_D4_WAVE_DIR,
} from './paths_d4.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';

/**
 * @param {string[]} adopt_ids
 * @param {Record<string, object>} candidate_by_id
 * @param {{ write?: boolean }} [opts]
 */
export function build_adopt_overlay_scheme(adopt_ids, candidate_by_id, opts) {
  const options = opts || {};
  const write = options.write !== false;

  const scheme = {
    schema_version: 1,
    enabled: false,
    adopt_note_zh:
      '本階段 enabled=false；啟用前須 npm test 全過 + 使用者確認。不覆寫 D.1 batch-drafts、D.3/D.4 草稿檔。',
    priority_zh: [
      '1. 人工確認（human_locked / manual-overrides / accepted review）',
      '2. verified_evidence（MusicBrainz 等直接事實）',
      '3. adopt_overlay 指定之 Cursor Agent 候選（D.3/D.4）',
      '4. g3_d1_batch 規則式匯入（現行 catalog）',
      '5. rule_classify / unknown',
    ],
    rollback_zh: '刪除或設 enabled=false 並移除 adopt-overlay-active.json 即可恢復現行 unified 建置結果',
    overlay_file: FILE_G3_D4_ADOPT_OVERLAY,
    fields_replaced: ['primary_genre', 'subgenres', 'secondary_genres', 'language', 'contexts', 'special_types'],
    candidate_sources: ['cursor_agent_g3_d3_repair', 'cursor_agent_g3_d4'],
  };

  const overlay = {
    schema_version: 1,
    enabled: false,
    generated_at: new Date().toISOString(),
    adopt_track_ids: adopt_ids.slice(),
    entries: adopt_ids.map(function (id) {
      const row = candidate_by_id[id];
      return {
        track_id: id,
        candidate_source: row ? row.source : null,
        snapshot: row
          ? {
              genre_profile: row.genre_profile,
              language: row.language,
              contexts: row.contexts || [],
              special_types: row.special_types || [],
              confidence_tier: row.confidence_tier,
            }
          : null,
      };
    }),
  };

  let simulation = null;
  const unified = load_unified_classification_view();
  if (unified && adopt_ids.length) {
    const balanced_now = compute_g3_unified_playlist_preview('balanced', {}, unified);
    const relaxed_now = compute_g3_unified_playlist_preview('relaxed', {}, unified);

    let would_change = 0;
    for (let i = 0; i < adopt_ids.length; i += 1) {
      const id = adopt_ids[i];
      const row = candidate_by_id[id];
      const v = unified.tracks[id];
      if (!row || !v) {
        continue;
      }
      const pk = v.primary_genre && v.primary_genre.value;
      const npk = row.genre_profile.primary_genre;
      if (pk !== npk) {
        would_change += 1;
      }
    }

    simulation = {
      schema_version: 1,
      enabled: false,
      balanced_total_now: balanced_now.total,
      relaxed_total_now: relaxed_now.total,
      adopt_id_count: adopt_ids.length,
      primary_genre_would_change_among_adopt_set: would_change,
      note_zh: '完整 tier 重算需啟用 overlay 後重建 unified；此為保守估計',
    };
  }

  if (write) {
    if (!fs.existsSync(G3_D4_WAVE_DIR)) {
      fs.mkdirSync(G3_D4_WAVE_DIR, { recursive: true });
    }
    write_json_atomic(FILE_G3_D4_ADOPT_SCHEME, scheme);
    write_json_atomic(FILE_G3_D4_ADOPT_OVERLAY, overlay);
    if (simulation) {
      write_json_atomic(FILE_G3_D4_ADOPT_SIMULATION, simulation);
    }
  }

  return { scheme: scheme, overlay: overlay, simulation: simulation };
}

/**
 * 模擬 200 首候選對 wave 指標（不寫 unified）
 */
export function simulate_full_200_candidate_metrics(d1_ids, d1_by, candidate_by_id) {
  let soundtrack = 0;
  let unknown_pk = 0;
  let quality_ok = 0;
  let needs_evidence = 0;
  let classification_unknown = 0;

  for (let i = 0; i < d1_ids.length; i += 1) {
    const id = d1_ids[i];
    const c = candidate_by_id[id] || d1_by[id];
    const pk = c.genre_profile ? c.genre_profile.primary_genre : GENRE_PRIMARY_UNKNOWN;
    if (pk === 'soundtrack_instrumental') {
      soundtrack += 1;
    }
    if (pk === 'unknown' || pk === GENRE_PRIMARY_UNKNOWN) {
      unknown_pk += 1;
    }
  }

  return {
    soundtrack_instrumental: soundtrack,
    primary_genre_unknown: unknown_pk,
    quality_ok: quality_ok,
    needs_evidence: needs_evidence,
    classification_unknown_quality: classification_unknown,
    note_zh: '完整 v2 需對每首跑 auto_review；見 comparison-d1-d2-d34-200.json stats',
  };
}
