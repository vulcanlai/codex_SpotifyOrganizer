/**
 * G2 進度（g2-30）
 */
import fs from 'node:fs';
import { get_g2_status_summary } from './lib/enrichment/external/run_g2_verification.js';
import { G2_TRIAL_DIR, file_verify_query_cache } from './lib/enrichment/external/verify_data_dir.js';
import { load_query_cache } from './lib/enrichment/external/verification_store.js';
import { set_verify_engine } from './lib/enrichment/external/verify_data_dir.js';

set_verify_engine('g2');
const status = get_g2_status_summary();
const cache = load_query_cache();
console.log('\n========== G2 狀態 ==========');
console.log('目錄:', G2_TRIAL_DIR);
console.log('已完成:', status.verified_final_count, '/', status.track_count);
console.log('請求:', status.progress.stats.network_requests);
console.log('快取:', Object.keys(cache.queries || {}).length);
console.log('存在:', fs.existsSync(G2_TRIAL_DIR) ? '是' : '否');
console.log('==============================\n');
