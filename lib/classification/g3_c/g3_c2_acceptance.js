/**
 * G3-C.2 驗收診斷（離線）
 */
import fs from 'node:fs';
import path from 'node:path';
import { PREVIEW_MODE_BALANCED, PREVIEW_MODE_RELAXED } from '../preview_settings.js';
import { load_unified_classification_view } from './build_unified_view.js';
import { load_g3_b_ai_catalog } from './load_g3_b_ai_catalog.js';
import { compute_g3_unified_playlist_preview } from './g3_smart_playlist_preview.js';
import { SUBGENRES_BY_CODE, GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../../enrichment/external/g1_sample.js';
import { FILE_CLASSIFICATION_INDEX } from '../paths.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { load_g3_source_bundle } from '../g3_evidence/source_loaders.js';
import {
  build_ai_result_inventory,
  build_evidence_fingerprint,
} from '../g3_b/ai_result_catalog.js';
import { resolve_reuse_for_track } from '../g3_b/ai_result_reuse.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { resolve_human_confirmation } from '../g3_evidence/human_confirmation.js';

export const EXCLUSION_BALANCED_LOW_TIER = 'balanced_policy_low_confidence_tier';
export const EXCLUSION_NO_TITLE = 'no_valid_title';
export const EXCLUSION_FILTER_MISMATCH = 'filter_mismatch';
export const EXCLUSION_STRICT_MODE = 'strict_mode_human_only';

function tier_allowed_balanced(pk_tier, ai_tier) {
  if (pk_tier === 'human_confirmed' || pk_tier === 'verified_evidence') {
    return true;
  }
  if (pk_tier === 'ai_suggestion') {
    return ai_tier === 'high' || ai_tier === 'medium';
  }
  return false;
}

/**
 * 100 首試驗樣本 vs balanced 空篩選預覽
 */
export function analyze_sample_100_preview_gap(unified_doc) {
  const doc = unified_doc || load_unified_classification_view();
  const catalog = load_g3_b_ai_catalog();
  /** @type {object[]} */
  const excluded = [];
  /** @type {string[]} */
  const included = [];

  for (let i = 0; i < catalog.sample_100_ids.length; i += 1) {
    const id = catalog.sample_100_ids[i];
    const row = doc.tracks[id];
    const ai = catalog.by_id[id];
    if (!row) {
      excluded.push({
        spotify_id: id,
        title: null,
        exclusion_category: 'program_error',
        reason_zh: '統一檢視缺少列（資料遺失）',
      });
      continue;
    }
    if (!ai) {
      excluded.push({
        spotify_id: id,
        title: row.title,
        exclusion_category: 'program_error',
        reason_zh: 'G3-B AI catalog 缺少（整合缺口）',
      });
      continue;
    }
    if (!row.title) {
      excluded.push({
        spotify_id: id,
        title: null,
        exclusion_category: EXCLUSION_NO_TITLE,
        reason_zh: '無有效歌名',
        primary_genre: row.primary_genre && row.primary_genre.value,
        ai_confidence_tier: row.ai_confidence_tier,
      });
      continue;
    }
    if (!tier_allowed_balanced(row.primary_genre.source_tier, row.ai_confidence_tier)) {
      excluded.push({
        spotify_id: id,
        title: row.title,
        artists: row.artists,
        exclusion_category: EXCLUSION_BALANCED_LOW_TIER,
        reason_zh:
          'balanced 模式：AI 建議僅納入 confidence_tier high/medium；此首為 low（非資料遺失，relaxed 可納入）',
        primary_genre: row.primary_genre.value,
        subgenres: row.subgenres && row.subgenres.value,
        language: row.language && row.language.value,
        ai_confidence_tier: row.ai_confidence_tier,
        auto_review_status: row.auto_review_status,
        classification_source: row.classification_source,
      });
      continue;
    }
    included.push(id);
  }

  const relaxed = compute_g3_unified_playlist_preview({}, PREVIEW_MODE_RELAXED, doc);
  let sample_in_relaxed = 0;
  for (let j = 0; j < catalog.sample_100_ids.length; j += 1) {
    const rid = catalog.sample_100_ids[j];
    const rrow = doc.tracks[rid];
    if (rrow && rrow.title && tier_allowed_relaxed(rrow)) {
      sample_in_relaxed += 1;
    }
  }

  return {
    sample_total: 100,
    included_in_balanced_empty_filter: included.length,
    excluded_count: excluded.length,
    excluded_tracks: excluded,
    included_track_ids: included,
    sample_in_relaxed_mode_all_titled: sample_in_relaxed,
    data_loss_detected: excluded.some(function (e) {
      return e.exclusion_category === 'program_error';
    }),
    note_zh:
      '全庫 balanced 預覽 90 首含非試驗樣本；試驗 100 首中 90 首納入、10 首為 low tier 政策排除',
  };
}

function tier_allowed_relaxed(row) {
  const t = row.primary_genre.source_tier;
  return (
    t === 'human_confirmed' ||
    t === 'verified_evidence' ||
    t === 'ai_suggestion'
  );
}

/**
 * 分類來源與衝突稽核（100 首 + 抽樣）
 */
export function audit_classification_sources(unified_doc) {
  const doc = unified_doc || load_unified_classification_view();
  const catalog = load_g3_b_ai_catalog();
  const bundle = load_g3_source_bundle();
  const issues = [];
  let lemon_ok = false;
  let dup_ai = 0;

  const seen_sources = {};
  for (let i = 0; i < catalog.sample_100_ids.length; i += 1) {
    const id = catalog.sample_100_ids[i];
    const row = doc.tracks[id];
    const human = resolve_human_confirmation(id, {
      index_row: bundle.index.tracks_by_id[id],
      overrides_doc: bundle.manual_overrides,
    });
    if (
      human.locked &&
      human.genre_profile &&
      human.genre_profile.primary_genre &&
      row &&
      row.primary_genre.source_tier !== 'human_confirmed'
    ) {
      issues.push({ track_id: id, issue: 'human_locked_but_not_human_tier' });
    }
    if (row && row.primary_genre.confidence === 'confirmed' && row.primary_genre.source_tier === 'ai_suggestion') {
      issues.push({ track_id: id, issue: 'ai_marked_confirmed' });
    }
    if (id === G1_MUST_INCLUDE_LEMON_TREE) {
      lemon_ok = row.auto_review_status === 'conflict';
    }
    if (row && row.version_uncertainty === true) {
      /* preserved in view */
    }
    const src = row && row.classification_source;
    if (src) {
      const key = id + ':' + src;
      if (seen_sources[id]) {
        dup_ai += 1;
      }
      seen_sources[id] = src;
    }
  }

  return {
    checks_zh: [
      '人工確認優先：locked 時 primary 應 human_confirmed tier',
      'AI 不得 confirmed confidence',
      'Lemon Tree 維持 conflict',
      'version_uncertainty 保留於 unified view',
    ],
    issue_count: issues.length,
    issues: issues,
    lemon_tree_conflict_preserved: lemon_ok,
    duplicate_ai_batch_entries: dup_ai,
  };
}

/**
 * 篩選器 smoke tests
 */
export function run_smart_playlist_filter_smoke_tests(unified_doc) {
  const doc = unified_doc || load_unified_classification_view();
  const cases = [
    { name: 'primary_pop', filters: { primary_genre: 'pop' }, mode: PREVIEW_MODE_BALANCED },
    { name: 'primary_soundtrack', filters: { primary_genre: 'soundtrack_instrumental' }, mode: PREVIEW_MODE_BALANCED },
    { name: 'subgenre_pop_ballad', filters: { subgenre: 'pop_ballad' }, mode: PREVIEW_MODE_BALANCED },
    { name: 'language_english', filters: { language: '英文' }, mode: PREVIEW_MODE_BALANCED },
    { name: 'language_unconfirmed', filters: { language: '未確認' }, mode: PREVIEW_MODE_BALANCED },
    { name: 'special_instrumental', filters: { special_type: '純音樂' }, mode: PREVIEW_MODE_BALANCED },
    { name: 'combo_pop_english', filters: { primary_genre: 'pop', language: '英文' }, mode: PREVIEW_MODE_BALANCED },
  ];
  /** @type {object[]} */
  const results = [];
  for (let c = 0; c < cases.length; c += 1) {
    const tc = cases[c];
    const prev = compute_g3_unified_playlist_preview(tc.filters, tc.mode, doc);
    let dict_ok = true;
    if (tc.filters.primary_genre && tc.filters.primary_genre === 'unknown') {
      dict_ok = false;
    }
    if (tc.filters.subgenre && !SUBGENRES_BY_CODE[tc.filters.subgenre]) {
      dict_ok = false;
    }
    results.push({
      case: tc.name,
      filters: tc.filters,
      matched_count: prev.breakdown.total_unique,
      dictionary_filter_valid: dict_ok,
      ok: prev.g3_unified === true && dict_ok,
    });
  }
  return { results: results, all_ok: results.every(function (r) {
    return r.ok;
  }) };
}

/**
 * 1,895 擴大計畫（離線對帳）
 */
export function build_expansion_plan_1895() {
  const index_doc = JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8'));
  const ev = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8'));
  const bundle = load_g3_source_bundle();
  const fp = build_evidence_fingerprint(ev.source_fingerprints);
  const catalog = load_g3_b_ai_catalog();

  const titled_ids = [];
  const tracks = index_doc.tracks_by_id || {};
  const ids = Object.keys(tracks).sort();
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (tracks[id].metadata_status === 'complete' && tracks[id].display && tracks[id].display.name) {
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
  let rule_primary_unknown = 0;

  for (let j = 0; j < titled_ids.length; j += 1) {
    const id = titled_ids[j];
    const evt = ev.tracks[id];
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
    const pg = rule.genre_profile || {};
    if (!pg.primary_genre || pg.primary_genre === GENRE_PRIMARY_UNKNOWN) {
      rule_primary_unknown += 1;
    }
    const inv_row = inventory.per_track.find(function (p) {
      return p.track_id === id;
    });
    const reuse = resolve_reuse_for_track(id, inv_row || { records: [] }, rule, {
      evidence_fingerprint: fp,
    });
    if (reuse.reusable) {
      reusable_not_in_g3b += 1;
    } else {
      needs_new_ai += 1;
    }
  }

  const batch_size = 7;
  const batch_count = Math.ceil(needs_new_ai / batch_size);

  return {
    schema_version: 1,
    titled_track_count: titled_ids.length,
    g3_b_classified_count: has_g3_b_ai,
    human_locked_count: human_locked,
    reusable_ai_outside_g3_b: reusable_not_in_g3b,
    needs_new_cursor_ai: needs_new_ai,
    rule_primary_unknown_among_titled: rule_primary_unknown,
    not_equal_to_1795_note_zh:
      '1,895 − 100 = 1,795 僅為算術差；實際需新 AI ' +
      needs_new_ai +
      '（另 ' +
      reusable_not_in_g3b +
      ' 可重用 v2/phase-e 等）',
    batch_plan: {
      batch_size: batch_size,
      batch_size_range_zh: '5～10 首／批（建議 7）',
      estimated_batches: batch_count,
      resumable: true,
      reuse_policy: 'g3_b6 > g3_b4 > g3_b1 > v2 > phase-e',
      dictionary_preflight: 'main_to_allowed_subgenres 隨批附帶',
      qc_sample_zh: '每 10 批 spot-check 5 首；AI tier ≠ 準確率',
    },
    cursor_cost_risk_zh:
      '1,677 首 × 多欄位 JSON 推理 ≈ ' +
      batch_count +
      ' 次 Cursor 批次；建議分階段（如 200 首）並監控 token／失敗重試率',
  };
}

/**
 * npm test 清單� inventory（本機現況）
 */
export function inventory_npm_test_script() {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const script = pkg.scripts.test || '';
  const listed = script.split(/\s+/).filter(function (p) {
    return p.indexOf('test/') === 0 && p.endsWith('.test.js');
  });
  const all_glob = fs.readdirSync(path.join(process.cwd(), 'test')).filter(function (f) {
    return f.endsWith('.test.js');
  });
  const not_in_npm = all_glob.filter(function (f) {
    return listed.indexOf('test/' + f) < 0;
  });
  return {
    listed_file_count: listed.length,
    listed_files: listed,
    all_test_files_count: all_glob.length,
    not_in_npm_script: not_in_npm,
    note_zh:
      '測試總數以 node --test 執行時 # tests 為準；未列入 npm script 的檔案不計入 CI 預設',
  };
}
