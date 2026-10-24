/**
 * G1 路徑：正式試驗目錄 vs 測試隔離（SPOTIFYORG_G1_DATA_DIR）
 */
import path from 'node:path';
import { project_root } from '../../config.js';

/** 正式 G1 試驗資料根目錄（npm 指令與 build 樣本一律寫入此處） */
export const G1_TRIAL_DIR = path.join(
  project_root,
  'backup',
  'enrichment',
  'external',
  'g1-30'
);

const ENV_G1_DATA_DIR = 'SPOTIFYORG_G1_DATA_DIR';

/**
 * 執行期讀寫目錄（查證結果、快取、進度、報告）。
 * 測試請設 SPOTIFYORG_G1_DATA_DIR 指向暫存目錄，避免污染正式試驗資料。
 */
export function active_g1_data_dir() {
  const override = process.env[ENV_G1_DATA_DIR];
  if (override && String(override).trim()) {
    return path.resolve(String(override).trim());
  }
  return G1_TRIAL_DIR;
}

export function file_g1_sample() {
  return path.join(active_g1_data_dir(), 'sample-30.json');
}

export function file_g1_selection_manifest() {
  return path.join(active_g1_data_dir(), 'selection-manifest.json');
}

export function file_g1_query_cache() {
  return path.join(active_g1_data_dir(), 'query-cache.json');
}

export function file_g1_verification() {
  return path.join(active_g1_data_dir(), 'verification-results.json');
}

export function file_g1_progress() {
  return path.join(active_g1_data_dir(), 'progress.json');
}

export function file_g1_quality_report() {
  return path.join(active_g1_data_dir(), 'quality-report.json');
}

/** 建立／更新 30 首樣本時固定寫入正式試驗目錄（不受測試 env 影響） */
export function file_g1_sample_trial() {
  return path.join(G1_TRIAL_DIR, 'sample-30.json');
}

export function file_g1_selection_manifest_trial() {
  return path.join(G1_TRIAL_DIR, 'selection-manifest.json');
}

/** mock 測試寫入特徵（用於辨識非 MusicBrainz 真實結果） */
export const G1_MOCK_EXTERNAL_IDS = ['rec-mock-1', 'rec-search-1'];
export const G1_MOCK_TITLES = ['Mock Title', 'Search Hit'];

/**
 * @param {object|null} row
 */
export function is_g1_mock_verification_row(row) {
  if (!row) {
    return false;
  }
  const best = row.best_match;
  if (best && G1_MOCK_EXTERNAL_IDS.indexOf(best.external_id) >= 0) {
    return true;
  }
  if (best && G1_MOCK_TITLES.indexOf(best.title) >= 0) {
    return true;
  }
  const cands = row.candidates || [];
  for (let i = 0; i < cands.length; i += 1) {
    if (G1_MOCK_EXTERNAL_IDS.indexOf(cands[i].external_id) >= 0) {
      return true;
    }
  }
  return false;
}

/**
 * @param {object} cache_doc
 */
export function cache_doc_has_mock_entries(cache_doc) {
  const queries = cache_doc && cache_doc.queries ? cache_doc.queries : {};
  const keys = Object.keys(queries);
  for (let i = 0; i < keys.length; i += 1) {
    const entry = queries[keys[i]];
    const cands = entry && entry.candidates ? entry.candidates : [];
    for (let j = 0; j < cands.length; j += 1) {
      if (G1_MOCK_EXTERNAL_IDS.indexOf(cands[j].external_id) >= 0) {
        return true;
      }
    }
  }
  return false;
}
