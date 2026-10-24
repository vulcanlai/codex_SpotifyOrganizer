/**
 * G3-B.5 離線：100 首樣本、批次計畫、字典報告（不執行 AI）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { load_g3_source_bundle } from '../g3_evidence/source_loaders.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { load_g3_b_sample_from_g1 } from './sample.js';
import { rule_classify_track } from './rule_classify.js';
import {
  build_ai_result_inventory,
  build_evidence_fingerprint,
} from './ai_result_catalog.js';
import { resolve_reuse_for_track } from './ai_result_reuse.js';
import {
  has_primary_genre_gap,
  has_language_gap,
} from './queue_state.js';
import { select_g3_b5_new_sample_ids, build_stratify_row } from './g3_b5_stratify.js';
import { build_genre_dictionary_quality_report } from './genre_dictionary_report.js';
import {
  assign_risk_tier,
  build_quality_check_sampling_plan,
} from './human_review_strategy_b5.js';
import { build_batch_plan, init_batch_progress } from './batch_plan.js';
import {
  G3_B5_TRIAL_DIR,
  G3_B5_SCHEMA_VERSION,
  G3_B5_BATCH_SIZE,
  FILE_G3_B5_SAMPLE_100,
  FILE_G3_B5_REUSE_30,
  FILE_G3_B5_NEW_70,
  FILE_G3_B5_AI_NEEDED,
  FILE_G3_B5_BATCH_PLAN,
  FILE_G3_B5_BATCH_PROGRESS,
  FILE_G3_B5_STRATIFICATION,
  FILE_G3_B5_GENRE_DICT_REPORT,
  FILE_G3_B5_UNIFIED_PLAN,
  FILE_G3_B5_HUMAN_REVIEW_STRATEGY,
  FILE_G3_B5_OFFLINE_SUMMARY,
} from './paths_b5.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function stratify_reason_zh(row) {
  const parts = [];
  parts.push('年代:' + row.decade);
  parts.push('索引語言:' + row.index_language.replace('index_tag:', ''));
  parts.push('歌名腳本:' + row.title_script);
  if (row.vocal_hint !== 'vocal_or_unknown') {
    parts.push(row.vocal_hint);
  }
  if (row.has_ai_candidate) {
    parts.push('已有AI候選');
  } else {
    parts.push('無AI候選');
  }
  if (row.enrichment_complete) {
    parts.push('enrichment完整');
  } else {
    parts.push('metadata不完整');
  }
  if (row.has_isrc) {
    parts.push('有ISRC');
  } else {
    parts.push('缺ISRC');
  }
  if (row.multi_artist) {
    parts.push('多藝人');
  }
  if (row.mb_g2_matched) {
    parts.push('G2比對命中');
  }
  return parts.join('；');
}

function classification_gaps(rule) {
  /** @type {string[]} */
  const gaps = [];
  if (has_primary_genre_gap(rule)) {
    gaps.push('primary_genre_unknown');
  }
  if (has_language_gap(rule)) {
    gaps.push('language_unconfirmed');
  }
  const ver = rule.version || {};
  if (ver.confidence === 'uncertain' || ver.value === '不確定') {
    gaps.push('version_uncertain');
  }
  return gaps;
}

function summarize_distribution(rows) {
  const count_key = function (key) {
    const o = {};
    for (let i = 0; i < rows.length; i += 1) {
      const v = rows[i][key];
      o[v] = (o[v] || 0) + 1;
    }
    return o;
  };
  return {
    by_decade: count_key('decade'),
    by_index_language: count_key('index_language'),
    by_title_script: count_key('title_script'),
    by_vocal_hint: count_key('vocal_hint'),
    has_ai_candidate: rows.filter(function (r) {
      return r.has_ai_candidate;
    }).length,
    no_ai_candidate: rows.filter(function (r) {
      return !r.has_ai_candidate;
    }).length,
    enrichment_complete: rows.filter(function (r) {
      return r.enrichment_complete;
    }).length,
    has_isrc: rows.filter(function (r) {
      return r.has_isrc;
    }).length,
    multi_artist: rows.filter(function (r) {
      return r.multi_artist;
    }).length,
  };
}

function batch_for_track(track_id, plan) {
  const batches = plan.batches || [];
  for (let i = 0; i < batches.length; i += 1) {
    if (batches[i].track_ids.indexOf(track_id) >= 0) {
      return batches[i].batch_id;
    }
  }
  return null;
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function run_g3_b5_offline_plan(opts) {
  const options = opts || {};
  const write = options.write !== false;

  if (write && !fs.existsSync(G3_B5_TRIAL_DIR)) {
    fs.mkdirSync(G3_B5_TRIAL_DIR, { recursive: true });
  }

  const cohort30 = load_g3_b_sample_from_g1().track_ids;
  const selection = select_g3_b5_new_sample_ids(70);
  const new70 = selection.selected_ids;
  const sample100 = cohort30.concat(new70).sort();

  if (sample100.length !== 100) {
    throw new Error('100 首樣本數量錯誤：' + sample100.length);
  }
  const uniq = {};
  for (let u = 0; u < sample100.length; u += 1) {
    if (uniq[sample100[u]]) {
      throw new Error('100 首樣本重複：' + sample100[u]);
    }
    uniq[sample100[u]] = true;
  }

  const ev_path = file_g3_evidence_index();
  const evidence_index = JSON.parse(fs.readFileSync(ev_path, 'utf8'));
  const bundle = load_g3_source_bundle();
  const evidence_fp = build_evidence_fingerprint(evidence_index.source_fingerprints);
  const index = bundle.index.tracks_by_id || {};

  const inventory70 = build_ai_result_inventory(new70, {
    bundle: bundle,
    evidence_fingerprint: evidence_fp,
    auto_review_results: [],
  });

  const needs_gen_ids = [];
  /** @type {object[]} */
  const plan_tracks = [];

  for (let c = 0; c < cohort30.length; c += 1) {
    const id = cohort30[c];
    const ev = evidence_index.tracks[id];
    const rule = rule_classify_track(ev);
    const idx = index[id] || {};
    const disp = idx.display || {};
    const row = {
      spotify_id: id,
      title: ev.identity.title,
      artists: ev.identity.artists || [],
      cohort: 'g3_b4_complete',
      selection_reason_zh: 'G3-B.4 已完成 30 首試驗 cohort；不得重新分類',
      evidence_state_zh: 'G3-B.4 已匯入批次 AI',
      has_reusable_ai: true,
      needs_new_generation: false,
      classification_gaps: classification_gaps(rule),
      planned_batch_id: null,
      reuse: {
        reusable: true,
        regen_required: false,
        regen_reason: null,
        note: 'G3-B.4 政策鎖定；不進 70 首生成佇列',
      },
      human_locked: !!(ev.human_confirmation && ev.human_confirmation.locked),
      vocal_hint: build_stratify_row(id, ev, idx).vocal_hint,
    };
    row.risk_tier = assign_risk_tier(row);
    plan_tracks.push(row);
  }

  for (let n = 0; n < new70.length; n += 1) {
    const id = new70[n];
    const ev = evidence_index.tracks[id];
    const rule = rule_classify_track(ev);
    const idx = index[id] || {};
    const strat =
      selection.selected_rows[n] || build_stratify_row(id, ev, idx);
    const inv = inventory70.per_track.find(function (p) {
      return p.track_id === id;
    });
    const reuse = resolve_reuse_for_track(id, inv || { records: [] }, rule, {
      evidence_fingerprint: evidence_fp,
      treat_conflict_as_regen: false,
    });
    const needs_gen = !reuse.reusable;
    if (needs_gen) {
      needs_gen_ids.push(id);
    }
    const track_row = {
      spotify_id: id,
      title: ev.identity.title,
      artists: ev.identity.artists || [],
      cohort: 'g3_b5_new_70',
      selection_reason_zh: stratify_reason_zh(strat),
      evidence_state_zh: strat.enrichment_complete
        ? 'enrichment 完整'
        : 'metadata／enrichment 不完整',
      has_reusable_ai: reuse.reusable,
      needs_new_generation: needs_gen,
      classification_gaps: classification_gaps(rule),
      planned_batch_id: null,
      reuse: reuse,
      human_locked: !!(ev.human_confirmation && ev.human_confirmation.locked),
      vocal_hint: strat.vocal_hint,
      stratify: strat,
    };
    plan_tracks.push(track_row);
  }

  const batch_plan = build_batch_plan(needs_gen_ids, G3_B5_BATCH_SIZE, {
    batch_id_prefix: 'g3b5-batch-',
  });
  const batch_progress = init_batch_progress(
    batch_plan,
    read_json(FILE_G3_B5_BATCH_PROGRESS)
  );

  for (let t = 0; t < plan_tracks.length; t += 1) {
    if (plan_tracks[t].needs_new_generation) {
      plan_tracks[t].planned_batch_id = batch_for_track(
        plan_tracks[t].spotify_id,
        batch_plan
      );
    }
    if (!plan_tracks[t].risk_tier) {
      plan_tracks[t].risk_tier = assign_risk_tier(plan_tracks[t]);
    }
  }

  const reusable70 = new70.length - needs_gen_ids.length;
  const genre_report = build_genre_dictionary_quality_report();
  const strat_report = {
    schema_version: G3_B5_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    seed: selection.seed,
    rules_zh: [
      '母體：evidence-index 全庫，排除 G3-B.4 已完成 30 首',
      '固定 seed 貪婪多樣性分數選 70 首（年代、歌名腳本、索引語言、AI 候選有無）',
      '索引語言標籤「未確認」不得視為 AI 已確認語言',
      '歌名腳本僅作代表性抽樣維度，非演唱語言定案',
    ],
    pool_size: selection.pool_size,
    new_70_distribution: summarize_distribution(selection.selected_rows),
    shortfalls_zh: [],
  };
  const dist = strat_report.new_70_distribution;
  if (!dist.by_title_script.script_korean) {
    strat_report.shortfalls_zh.push('70 首內無韓文歌名腳本命中；未虛構配額');
  }
  if (dist.by_index_language['index_tag:未確認'] === 70) {
    strat_report.shortfalls_zh.push(
      '70 首索引語言標籤皆「未確認」；語言代表性需靠歌名腳本／後續 vocal 查證，非 AI 定案'
    );
  }
  if (dist.enrichment_complete < 10) {
    strat_report.shortfalls_zh.push(
      'enrichment 完整僅 ' + dist.enrichment_complete + ' 首；多數為 metadata 不完整樣本'
    );
  }
  if (dist.has_ai_candidate < 5) {
    strat_report.shortfalls_zh.push(
      '已有 AI 候選僅 ' + dist.has_ai_candidate + ' 首；「有／無候選」分層受母體分布限制'
    );
  }
  if ((dist.by_decade['年代未知'] || 0) > 40) {
    strat_report.shortfalls_zh.push('年代標籤「年代未知」占比高；年代分層代表性有限');
  }

  const human_strategy = {
    schema_version: G3_B5_SCHEMA_VERSION,
    tiers: [
      { code: 'preview_ok', zh: '可直接用於本機歌單預覽' },
      { code: 'needs_supplemental_evidence', zh: '需要補充證據' },
      { code: 'classification_conflict', zh: '有分類衝突' },
      { code: 'requires_human_decision', zh: '真正需要人工決策' },
    ],
    quality_sampling: build_quality_check_sampling_plan(100),
    lemon_tree_zh:
      '05B8gt3dCepBPmGe7SPAUo 保留 G3-B.1 英文與 G3-B.2 衝突；fixture 國語不得偽裝 MB 查證',
    instrumental_zh:
      'vocal_hint 區分 instrumental_index_tag／instrumental_title_hint／vocal_or_unknown',
  };

  const summary = {
    schema_version: G3_B5_SCHEMA_VERSION,
    generated_at: strat_report.generated_at,
    total_tracks: 100,
    cohort_30: cohort30.length,
    new_70: new70.length,
    reusable_ai_in_70: reusable70,
    needs_new_generation_in_70: needs_gen_ids.length,
    batch_count: batch_plan.batch_count,
    batch_size: G3_B5_BATCH_SIZE,
    evidence_fingerprint: evidence_fp,
    ready_for_70_ai_run: needs_gen_ids.length > 0,
    summary_zh: [
      '100 首 = 30（G3-B.4 鎖定）+ 70（新抽樣）',
      '70 首中可重用 AI ' + reusable70 + ' 首；須新生成 ' + needs_gen_ids.length + ' 首',
      '批次 ' + batch_plan.batch_count + ' 批（每批最多 ' + G3_B5_BATCH_SIZE + ' 首）',
    ],
  };

  const outputs = {
    sample_100: {
      schema_version: G3_B5_SCHEMA_VERSION,
      generated_at: summary.generated_at,
      seed: selection.seed,
      track_ids: sample100,
    },
    reuse_30: {
      schema_version: G3_B5_SCHEMA_VERSION,
      track_ids: cohort30,
      policy_zh: '不重新執行 Cursor AI；沿用 G3-B.1/B.4 匯入結果',
    },
    new_70: {
      schema_version: G3_B5_SCHEMA_VERSION,
      track_ids: new70,
      rows: selection.selected_rows,
    },
    ai_needed: {
      schema_version: G3_B5_SCHEMA_VERSION,
      track_ids: needs_gen_ids.sort(),
      count: needs_gen_ids.length,
    },
    unified_plan: {
      schema_version: G3_B5_SCHEMA_VERSION,
      generated_at: summary.generated_at,
      tracks: plan_tracks.sort(function (a, b) {
        return a.spotify_id < b.spotify_id ? -1 : 1;
      }),
    },
  };

  if (write) {
    write_json_atomic(FILE_G3_B5_SAMPLE_100, outputs.sample_100);
    write_json_atomic(FILE_G3_B5_REUSE_30, outputs.reuse_30);
    write_json_atomic(FILE_G3_B5_NEW_70, outputs.new_70);
    write_json_atomic(FILE_G3_B5_AI_NEEDED, outputs.ai_needed);
    write_json_atomic(FILE_G3_B5_BATCH_PLAN, batch_plan);
    write_json_atomic(FILE_G3_B5_BATCH_PROGRESS, batch_progress);
    write_json_atomic(FILE_G3_B5_STRATIFICATION, strat_report);
    write_json_atomic(FILE_G3_B5_GENRE_DICT_REPORT, genre_report);
    write_json_atomic(FILE_G3_B5_UNIFIED_PLAN, outputs.unified_plan);
    write_json_atomic(FILE_G3_B5_HUMAN_REVIEW_STRATEGY, human_strategy);
    write_json_atomic(FILE_G3_B5_OFFLINE_SUMMARY, summary);
  }

  return {
    summary: summary,
    sample100: sample100,
    needs_gen_ids: needs_gen_ids,
    batch_plan: batch_plan,
    strat_report: strat_report,
    genre_report: genre_report,
    plan_tracks: outputs.unified_plan.tracks,
  };
}
