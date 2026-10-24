/**
 * G1 試驗品質報告（繁中摘要）
 */
import { write_json_atomic } from '../../atomic_json.js';
import { VERIFY_STATUS } from './paths.js';
import { file_verify_quality_report } from './verify_data_dir.js';
import { get_verify_engine } from './verify_data_dir.js';
import { load_g1_trial_sample } from './g1_sample.js';
import { load_verification_results, load_progress } from './verification_store.js';

/**
 * @param {{ write?: boolean }} [opts]
 */
export function build_g1_quality_report(opts) {
  const options = opts || {};
  const sample = load_g1_trial_sample();
  const ver = load_verification_results();
  const progress = load_progress();
  const ids = sample ? sample.track_ids : [];

  let with_candidates = 0;
  let reliable_match = 0;
  let ambiguous = 0;
  let not_found = 0;
  let with_genre_tags = 0;
  let with_language_evidence = 0;

  for (let i = 0; i < ids.length; i += 1) {
    const row = ver.tracks[ids[i]];
    if (!row) {
      continue;
    }
    const st = row.verify_status;
    if (row.candidates && row.candidates.length) {
      with_candidates += 1;
    }
    if (st === VERIFY_STATUS.matched) {
      reliable_match += 1;
    }
    if (st === VERIFY_STATUS.ambiguous || row.version_ambiguous) {
      ambiguous += 1;
    }
    if (st === VERIFY_STATUS.not_found) {
      not_found += 1;
    }
    const tags = row.facts && row.facts.genre_tags_from_source;
    if (tags && tags.length) {
      with_genre_tags += 1;
    }
    const lang = row.inference && row.inference.vocal_language;
    if (lang && lang.value !== 'unknown' && lang.confidence > 0) {
      with_language_evidence += 1;
    }
  }

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    sample_id: sample ? sample.sample_id : null,
    totals: {
      test_track_count: ids.length,
      tracks_with_verification_row: Object.keys(ver.tracks || {}).length,
      with_search_candidates: with_candidates,
      reliable_recording_match: reliable_match,
      version_ambiguous: ambiguous,
      not_found: not_found,
      with_genre_tags_from_source: with_genre_tags,
      with_vocal_language_evidence: with_language_evidence,
    },
    network: {
      requests: progress.stats ? progress.stats.network_requests : 0,
      cache_hits: progress.stats ? progress.stats.cache_hits : 0,
      retries: progress.stats ? progress.stats.retries : 0,
      errors: progress.stats ? progress.stats.errors : 0,
    },
    distinctions_note:
      '「有搜尋結果」「可靠比對錄音」「有足夠證據供分類」為不同層級；本報告不自宣 AI 分類準確率。',
    g2_suggestions: [
      '增加第二資料來源（如 Discogs 或 Wikidata）交叉驗證 ISRC 與版本',
      '對 ambiguous 曲目引入 duration ±2s 與發行年硬門檻',
      '演唱語言需獨立來源（歌詞授權庫或人工標註），勿由歌名推斷',
      '華語／翻唱曲提高 artist+title 模糊比對與別名表',
    ],
    summary_zh: [
      '測試歌曲總數：' + ids.length,
      '已有查證列：' + Object.keys(ver.tracks || {}).length,
      '有候選搜尋結果：' + with_candidates,
      '可靠比對錄音：' + reliable_match,
      '版本歧義：' + ambiguous,
      '查無可靠資料：' + not_found,
      '取得曲風標籤：' + with_genre_tags,
      '有根據的演唱語言（G1 預期多為 0）：' + with_language_evidence,
      '網路請求：' + (progress.stats ? progress.stats.network_requests : 0),
      '快取命中：' + (progress.stats ? progress.stats.cache_hits : 0),
    ],
  };

  if (options.write) {
    report.verify_engine = get_verify_engine();
    write_json_atomic(file_verify_quality_report(), report);
  }

  return report;
}
