/**
 * G3-D.1 需新 Cursor AI 母體（1,676 對帳）
 */
import fs from 'node:fs';
import { FILE_CLASSIFICATION_INDEX } from '../paths.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { load_g3_source_bundle } from '../g3_evidence/source_loaders.js';
import {
  build_ai_result_inventory,
  build_evidence_fingerprint,
} from '../g3_b/ai_result_catalog.js';
import { resolve_reuse_for_track } from '../g3_b/ai_result_reuse.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { load_g3_b_ai_catalog } from '../g3_c/load_g3_b_ai_catalog.js';
import { build_stratify_row } from '../g3_b/g3_b5_stratify.js';
import { resolve_human_confirmation } from '../g3_evidence/human_confirmation.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import { validate_genre_profile_draft } from '../g3_b/rule_classify.js';
import { SUBGENRES_BY_CODE } from '../genre_taxonomy.js';

/**
 * @returns {object}
 */
export function build_g3_d1_expansion_pool() {
  const index_doc = JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8'));
  const ev_doc = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8'));
  const bundle = load_g3_source_bundle();
  const fp = build_evidence_fingerprint(ev_doc.source_fingerprints);
  const catalog = load_g3_b_ai_catalog();
  const tracks = index_doc.tracks_by_id || {};
  const evidence_by_id = ev_doc.tracks || {};

  const titled_ids = [];
  const ids = Object.keys(tracks).sort();
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (
      tracks[id].metadata_status === 'complete' &&
      tracks[id].display &&
      tracks[id].display.name
    ) {
      titled_ids.push(id);
    }
  }

  const inventory = build_ai_result_inventory(titled_ids, {
    bundle: bundle,
    evidence_fingerprint: fp,
  });

  let human_locked = 0;
  let has_g3_b_ai = 0;
  let reusable_not_in_g3b = 0;
  let needs_new_ai = 0;
  /** @type {object[]} */
  const pool_rows = [];
  /** @type {object[]} */
  const reusable_audit = [];

  for (let j = 0; j < titled_ids.length; j += 1) {
    const id = titled_ids[j];
    const evt = evidence_by_id[id];
    const human = resolve_human_confirmation(id, {
      index_row: tracks[id],
      overrides_doc: bundle.manual_overrides,
    });
    if (human.locked) {
      human_locked += 1;
    }
    if (catalog.sample_100_ids.indexOf(id) >= 0 && catalog.by_id[id]) {
      has_g3_b_ai += 1;
      continue;
    }
    if (catalog.by_id[id] && catalog.by_id[id].source === 'g3_d1_batch') {
      continue;
    }
    if (catalog.by_id[id]) {
      continue;
    }
    const rule = rule_classify_track(evt);
    const inv_row = inventory.per_track.find(function (p) {
      return p.track_id === id;
    });
    const reuse = resolve_reuse_for_track(id, inv_row || { records: [] }, rule, {
      evidence_fingerprint: fp,
    });
    if (reuse.reusable) {
      reusable_not_in_g3b += 1;
      const best = reuse.best_record;
      const schema_issues = [];
      if (best) {
        const gp = {
          primary_genre: best.primary_genre,
          secondary_genres: best.secondary_genres || [],
          subgenres: best.subgenres || [],
          confidence: 'inferred',
        };
        if (!validate_genre_profile_draft(gp)) {
          schema_issues.push('非法主曲風組合');
        }
        for (let s = 0; s < gp.subgenres.length; s += 1) {
          const sub = gp.subgenres[s];
          if (!SUBGENRES_BY_CODE[sub]) {
            schema_issues.push('非法子曲風 ' + sub);
          } else if (
            gp.primary_genre !== 'unknown' &&
            SUBGENRES_BY_CODE[sub].main !== gp.primary_genre
          ) {
            schema_issues.push('子曲風 parent 不符 ' + sub);
          }
        }
        if (best.confidence === 'confirmed') {
          schema_issues.push('不得 confirmed');
        }
      }
      reusable_audit.push({
        track_id: id,
        title: evt.identity.title,
        source: best && best.source,
        primary_genre: best && best.primary_genre,
        schema_ok: schema_issues.length === 0,
        schema_issues: schema_issues,
        g3_b_import_shape_note_zh:
          'phase-e/v2 歷史候選可能缺 vocal_verification_status；G3-B 匯入會 normalize，不視為不可重用',
      });
      continue;
    }
    needs_new_ai += 1;
    pool_rows.push(
      build_stratify_row(id, evt, tracks[id] || {})
    );
  }

  const arithmetic =
    has_g3_b_ai + reusable_not_in_g3b + needs_new_ai;
  const reconcile_note_zh =
    '有曲名 ' +
    titled_ids.length +
    ' = G3-B AI ' +
    has_g3_b_ai +
    ' + 可重用 ' +
    reusable_not_in_g3b +
    ' + 需新 AI ' +
    needs_new_ai +
    '（人工鎖定 ' +
    human_locked +
    ' 首可能與上述重疊）';

  return {
    titled_track_count: titled_ids.length,
    g3_b_classified_count: has_g3_b_ai,
    human_locked_count: human_locked,
    reusable_ai_outside_g3_b: reusable_not_in_g3b,
    needs_new_cursor_ai: needs_new_ai,
    pool_rows: pool_rows,
    reusable_audit: reusable_audit,
    reconcile: {
      sum_segments: arithmetic,
      matches_titled: arithmetic <= titled_ids.length,
      note_zh: reconcile_note_zh,
    },
    evidence_fingerprint: fp,
  };
}

/**
 * 統一檢視中 AI primary 為 unknown 但 merged 報告非 unknown 的對照（顯示「—」線索）
 */
export function analyze_primary_display_gap() {
  const catalog = load_g3_b_ai_catalog();
  const sample_ids = catalog.sample_100_ids || [];
  /** @type {object[]} */
  const gaps = [];
  for (let i = 0; i < sample_ids.length; i += 1) {
    const id = sample_ids[i];
    const ai = catalog.by_id[id];
    if (!ai || !ai.row || !ai.row.genre_profile) {
      gaps.push({
        track_id: id,
        issue: 'missing_ai_in_catalog',
      });
      continue;
    }
    const pg = ai.row.genre_profile.primary_genre;
    if (!pg || pg === GENRE_PRIMARY_UNKNOWN) {
      gaps.push({
        track_id: id,
        title: ai.row.title,
        issue: 'ai_primary_unknown',
        source: ai.source,
      });
    }
  }
  return {
    sample_100_ai_primary_unknown_count: gaps.filter(function (g) {
      return g.issue === 'ai_primary_unknown';
    }).length,
    gaps: gaps,
    note_zh:
      'G3-B.6 merged 報告統計的是已匯入 AI 列；UI「—」常見於正式索引 genre_profile 為空且尚無 G3-B AI 列，或欄位級 fallback 為 unknown（應顯示「未確認」非資料遺失）',
  };
}
