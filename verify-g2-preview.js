/**
 * G2 離線預覽（結果目錄 g2-30）
 */
import { run_g2_verification } from './lib/enrichment/external/run_g2_verification.js';
import { G2_TRIAL_DIR } from './lib/enrichment/external/verify_data_dir.js';

const result = await run_g2_verification({ online: false });
console.log('\n========== G2 離線預覽 ==========');
console.log('引擎: g2 · 目錄:', G2_TRIAL_DIR);
console.log('預覽曲目:', result.previews.length);
console.log('略過:', result.skipped);
console.log('連線試驗: npm run verify:g2-run -- --online');
console.log('==================================\n');
