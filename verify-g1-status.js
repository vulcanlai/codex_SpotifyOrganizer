/**
 * 檢查 G1 快取與查證進度
 * npm run verify:g1-status
 */
import fs from 'node:fs';
import { get_g1_status_summary } from './lib/enrichment/external/run_verification.js';
import { set_verify_engine } from './lib/enrichment/external/verify_data_dir.js';

set_verify_engine('g1');
import {
  file_g1_query_cache,
  file_g1_verification,
  file_g1_progress,
  file_g1_sample,
  G1_TRIAL_DIR,
} from './lib/enrichment/external/g1_path_resolve.js';
import { load_query_cache } from './lib/enrichment/external/verification_store.js';

const status = get_g1_status_summary();
const cache = load_query_cache();
const cache_keys = Object.keys(cache.queries || {}).length;

console.log('\n========== G1 狀態 ==========');
console.log('樣本:', status.sample_loaded ? status.sample_id : '（未建立）');
console.log('樣本曲目:', status.track_count);
console.log('已完成查證:', status.verified_final_count);
console.log('模式:', status.progress.mode);
console.log('網路請求:', status.progress.stats.network_requests);
console.log('快取命中:', status.progress.stats.cache_hits);
console.log('快取查詢鍵數:', cache_keys);
console.log('檔案:');
[
  file_g1_sample(),
  file_g1_verification(),
  file_g1_progress(),
  file_g1_query_cache(),
].forEach(
  function (p) {
    console.log(' ', fs.existsSync(p) ? '✓' : '✗', p);
  }
);
console.log('==============================\n');
