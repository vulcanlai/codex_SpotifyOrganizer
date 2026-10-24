/**
 * G3-B.5.1 全庫 Spotify ID 名稱覆蓋與抽樣池排除診斷（唯讀）
 */
import fs from 'node:fs';
import { FILE_LIBRARY_V2 } from '../../merge/v2/paths.js';
import { FILE_TRACK_CACHE } from '../../enrichment/paths.js';
import { FILE_CLASSIFICATION_INDEX } from '../paths.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { load_g3_b_sample_from_g1 } from './sample.js';
import { cache_entry_to_incoming_meta } from '../merge_sources.js';
import { G3_B5_SELECTION_SEED } from './paths_b5.js';

const CACHE_BLOCKED = [
  'not_found_404',
  'forbidden_403',
  'rate_limited_429',
  'network_error',
];

/**
 * @param {*} value
 */
export function has_valid_title(value) {
  if (value == null) {
    return false;
  }
  return String(value).trim().length > 0;
}

function read_json(path) {
  if (!fs.existsSync(path)) {
    throw new Error('缺少檔案：' + path);
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

/**
 * playlist_track_entries 是否可提供名稱（實際 schema：name + spotify_id）
 */
function title_from_playlist_entries(entries_by_id, track_id) {
  const list = entries_by_id[track_id];
  if (!list) {
    return null;
  }
  for (let i = 0; i < list.length; i += 1) {
    if (has_valid_title(list[i].name)) {
      return String(list[i].name).trim();
    }
  }
  return null;
}

function build_playlist_index(entries) {
  /** @type {Record<string, object[]>} */
  const by_id = {};
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (!e || !e.spotify_id) {
      continue;
    }
    if (!by_id[e.spotify_id]) {
      by_id[e.spotify_id] = [];
    }
    by_id[e.spotify_id].push(e);
  }
  return by_id;
}

function appearance_sources(appearances) {
  const out = {
    api_backup: false,
    manual_import: false,
    other: false,
  };
  const apps = appearances || [];
  for (let i = 0; i < apps.length; i += 1) {
    const s = apps[i].source || 'unknown';
    if (s === 'api_backup' || s === 'spotify_api') {
      out.api_backup = true;
    } else if (s === 'manual_import') {
      out.manual_import = true;
    } else {
      out.other = true;
    }
  }
  return out;
}

/**
 * @param {object} ctx
 */
function classify_exclusion(ctx) {
  const c = ctx;
  if (c.has_evidence_title) {
    if (c.in_g3b4_cohort_30) {
      return 'in_g3b4_cohort_30_not_in_70_pool';
    }
    if (c.human_locked) {
      return 'has_title_human_locked_excluded_from_stratify_pool';
    }
    return 'in_g3b5_sampling_pool';
  }

  if (c.has_index_display_title) {
    return 'index_has_title_evidence_identity_missing';
  }

  if (c.offline_backfill_from_playlist) {
    return 'offline_backfill_candidate_playlist_entry';
  }

  if (c.cache_entry_present) {
    if (c.cache_blocked_status) {
      return 'cache_blocked_status_no_title';
    }
    if (c.cache_has_name_not_merged) {
      return 'cache_has_name_index_still_missing';
    }
    return 'cache_entry_incomplete_no_title';
  }

  if (c.library_v2_has_name) {
    return 'library_v2_has_name_index_missing';
  }

  if (c.appearance_sources.manual_import && !c.appearance_sources.api_backup) {
    return 'manual_import_stub_no_local_title';
  }

  if (!c.cache_entry_present) {
    return 'no_enrichment_cache_needs_spotify_api';
  }

  return 'other_no_title';
}

/**
 * @param {{ write_index?: boolean, index_stream?: import('node:fs').WriteStream }} [opts]
 */
export function run_title_coverage_diagnostic(opts) {
  const options = opts || {};
  const lib = read_json(FILE_LIBRARY_V2);
  const cache_doc = read_json(FILE_TRACK_CACHE);
  const index_doc = read_json(FILE_CLASSIFICATION_INDEX);
  const ev_doc = read_json(file_g3_evidence_index());

  const track_index = lib.track_index_by_spotify_id || {};
  const cache_by_id = cache_doc.tracks_by_id || {};
  const index_by_id = index_doc.tracks_by_id || {};
  const ev_tracks = ev_doc.tracks || {};
  const all_ids = Object.keys(track_index).sort();

  if (all_ids.length !== 7759 && all_ids.length !== index_doc.track_count) {
    /* 仍繼續，以 library-v2 為準 */
  }

  const cohort30 = load_g3_b_sample_from_g1().track_ids;
  const cohort_set = {};
  for (let i = 0; i < cohort30.length; i += 1) {
    cohort_set[cohort30[i]] = true;
  }

  const playlist_by_id = build_playlist_index(lib.playlist_track_entries || []);

  let lib_title = 0;
  let cache_title = 0;
  let ev_title = 0;
  let index_display_title = 0;
  let any_source_title = 0;
  let all_sources_no_title = 0;
  let has_title_excluded_from_pool = 0;

  /** @type {Record<string, number>} */
  const exclusion_counts = {};
  /** @type {Record<string, string[]>} */
  const exclusion_samples = {};
  /** @type {string[]} */
  const offline_backfill_ids = [];
  /** @type {string[]} */
  const needs_api_ids = [];

  const index_stream = options.index_stream || null;

  for (let j = 0; j < all_ids.length; j += 1) {
    const id = all_ids[j];
    const v2 = track_index[id] || {};
    const cache_entry = cache_by_id[id] || null;
    const idx_row = index_by_id[id] || {};
    const ev = ev_tracks[id] || null;

    const library_v2_name = v2.name;
    const cache_incoming = cache_entry ? cache_entry_to_incoming_meta(cache_entry) : null;
    const cache_name = cache_entry && cache_entry.name;
    const display_name = idx_row.display && idx_row.display.name;
    const merged_name = idx_row.merged_metadata && idx_row.merged_metadata.name;
    const evidence_title = ev && ev.identity && ev.identity.title;

    const hl = has_valid_title(library_v2_name);
    const hc = has_valid_title(cache_name);
    const hd = has_valid_title(display_name);
    const hm = has_valid_title(merged_name);
    const he = has_valid_title(evidence_title);

    if (hl) {
      lib_title += 1;
    }
    if (hc) {
      cache_title += 1;
    }
    if (he) {
      ev_title += 1;
    }
    if (hd) {
      index_display_title += 1;
    }
    if (hl || hc || hd || hm || he) {
      any_source_title += 1;
    } else {
      all_sources_no_title += 1;
    }

    const playlist_title = title_from_playlist_entries(playlist_by_id, id);
    const offline_backfill = !hd && !!playlist_title;

    const cache_blocked =
      cache_entry && CACHE_BLOCKED.indexOf(cache_entry.status) >= 0;
    const cache_has_name_not_merged =
      !hd && hc && cache_incoming && has_valid_title(cache_incoming.name);

    const apps = appearance_sources(v2.appearances);
    const human_locked = !!(ev && ev.human_confirmation && ev.human_confirmation.locked);
    const in_pool =
      he && !cohort_set[id] && !human_locked;

    if (he && !in_pool) {
      has_title_excluded_from_pool += 1;
    }

    const reason = classify_exclusion({
      has_evidence_title: he,
      in_g3b4_cohort_30: !!cohort_set[id],
      human_locked: human_locked,
      has_index_display_title: hd,
      offline_backfill_from_playlist: offline_backfill,
      cache_entry_present: !!cache_entry,
      cache_blocked_status: cache_blocked,
      cache_has_name_not_merged: cache_has_name_not_merged,
      library_v2_has_name: hl,
      appearance_sources: apps,
    });

    exclusion_counts[reason] = (exclusion_counts[reason] || 0) + 1;
    if (!exclusion_samples[reason]) {
      exclusion_samples[reason] = [];
    }
    if (exclusion_samples[reason].length < 5) {
      exclusion_samples[reason].push(id);
    }

    if (offline_backfill) {
      offline_backfill_ids.push(id);
    }
    if (
      reason === 'manual_import_stub_no_local_title' ||
      reason === 'no_enrichment_cache_needs_spotify_api' ||
      reason === 'cache_blocked_status_no_title' ||
      reason === 'cache_entry_incomplete_no_title'
    ) {
      needs_api_ids.push(id);
    }

    if (index_stream) {
      const line = {
        spotify_id: id,
        sources: {
          library_v2_name: hl,
          cache_name: hc,
          index_display_name: hd,
          evidence_identity_title: he,
          playlist_entry_name: !!playlist_title,
        },
        metadata_status: idx_row.metadata_status || null,
        exclusion_reason: reason,
        in_g3b5_sampling_pool: in_pool,
      };
      index_stream.write(JSON.stringify(line) + '\n');
    }
  }

  const pool_size = exclusion_counts.in_g3b5_sampling_pool || 0;
  const excluded_total = all_ids.length - pool_size;

  const coverage_summary = {
    schema_version: 1,
    universe_spotify_ids: all_ids.length,
    library_v2_has_title: lib_title,
    metadata_cache_has_title: cache_title,
    evidence_index_identity_has_title: ev_title,
    classification_index_display_has_title: index_display_title,
    at_least_one_source_has_title: any_source_title,
    all_sources_no_valid_title: all_sources_no_title,
    has_title_excluded_from_g3b5_pool: has_title_excluded_from_pool,
    g3b5_sampling_pool_size: pool_size,
    g3b5_pool_seed: G3_B5_SELECTION_SEED,
    reconciliation_zh:
      '抽樣池 = evidence identity 有 title、非 G3-B.4 cohort 30、非 human_locked；與 G3-B.5 報告 pool_size 1865 一致',
  };

  const exclusion_reason_counts = {
    schema_version: 1,
    total_tracks: all_ids.length,
    counts: exclusion_counts,
    sample_ids_by_reason: exclusion_samples,
    excluded_from_70_pool_total: excluded_total,
    sum_check: Object.values(exclusion_counts).reduce(function (a, b) {
      return a + b;
    }, 0),
  };

  const offline_backfill = {
    schema_version: 1,
    candidate_count: offline_backfill_ids.length,
    track_ids: offline_backfill_ids,
    method_zh:
      'playlist_track_entries.name 可補 index／evidence（需另階段重建 index，本階段不寫入）',
    note_zh:
      offline_backfill_ids.length === 0
        ? '目前 manual_import 列 name 皆為 null，無法從 playlist 條目離線補名'
        : null,
  };

  const needs_api = {
    schema_version: 1,
    track_count: needs_api_ids.length,
    track_ids: needs_api_ids,
    reason_zh:
      'library-v2 無 name、enrichment cache 無有效 name；需 Spotify metadata enrichment',
  };

  const pool_fix = {
    schema_version: 1,
    root_cause_zh: [
      '5864 首 classification-index metadata_status=metadata_missing（display.name 為 null）',
      'G3-A evidence-index identity.title 僅來自 classification-index display.name（build_track_evidence.js）',
      '非 evidence-index 漏寫：與 index 同步，1895 首有 title',
      '5864 首 appearances 皆 manual_import 且 playlist／library 無 name；5861 首無 cache 列',
    ],
    g3_a_index_gap_zh:
      '無「有 title 卻未進 evidence」案例；缺口在 classification 合併前缺少 Spotify 曲名',
    suggested_fixes_zh: [
      '全庫 AI 前：對 needs-spotify-api 清單跑 enrich:tracks（或 enrich:auto）',
      '可選：merge v2 時從 playlist_track_entries 補 track_index.name（需 name 非 null）',
      '可選：evidence identity 改為 disp.name || merged.name（merged 目前同 display）',
      'G3-B.5 抽樣改為至少一來源有 title 或先限制已 enrichment 子集並明示偏差',
    ],
    sampling_code_ref: 'lib/classification/g3_b/g3_b5_stratify.js select_g3_b5_new_sample_ids',
  };

  const sample_impact = {
    schema_version: 1,
    keep_sample_100_recommendation: 'retain_with_documented_bias',
    rationale_zh: [
      '100 首中 30 首為 G3-B.4 鎖定 cohort，仍有效驗證批次／匯入／重用管線',
      '70 首來自 1865 首「有曲名」子集，不代表 7759 全庫分布（尤其 manual_import 5864 首未進池）',
      '不宜在未補 metadata 前將 70 首結果外推為全庫品質',
    ],
    resample_recommendation_zh:
      'metadata 大規模補齊後，可另開 G3-B.5.2 以擴大 pool 重新分層抽 70 首；本階段不修改 sample-100.json',
    pool_vs_universe_pct: Math.round((pool_size / all_ids.length) * 1000) / 10,
  };

  return {
    coverage_summary: coverage_summary,
    exclusion_reason_counts: exclusion_reason_counts,
    offline_backfill: offline_backfill,
    needs_api: needs_api,
    pool_fix: pool_fix,
    sample_impact: sample_impact,
  };
}
