/**
 * 建立 G1 三十首試驗樣本
 * npm run verify:g1-build-sample
 */
import { build_g1_sample } from './lib/enrichment/external/g1_sample.js';
import { G1_TRIAL_DIR } from './lib/enrichment/external/g1_path_resolve.js';

const result = build_g1_sample({ write: true });
console.log('\n========== G1 試驗樣本 ==========');
console.log('sample_id:', result.sample_doc.sample_id);
console.log('曲目數:', result.sample_doc.track_count);
console.log('必含 Lemon Tree:', result.sample_doc.must_include.join(', '));
console.log('輸出目錄:', G1_TRIAL_DIR);
console.log('==================================\n');
