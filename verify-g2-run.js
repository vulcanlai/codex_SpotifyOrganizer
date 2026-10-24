/**
 * G2 線上查證（不覆寫 g1-30）
 * npm run verify:g2-run -- --online
 */
import { run_g2_verification } from './lib/enrichment/external/run_g2_verification.js';
import { build_g1_quality_report } from './lib/enrichment/external/quality_report.js';
import { set_verify_engine } from './lib/enrichment/external/verify_data_dir.js';
import { G2_TRIAL_DIR } from './lib/enrichment/external/verify_data_dir.js';

const args = process.argv.slice(2);
const online = args.indexOf('--online') >= 0;
const force = args.indexOf('--force') >= 0;

if (!online) {
  console.log('預設離線。請加 --online 執行 G2 MusicBrainz 查證（不會呼叫 Spotify API）。');
  const preview = await run_g2_verification({ online: false });
  console.log('預覽:', preview.previews.length, '首 · 目錄', G2_TRIAL_DIR);
  process.exit(0);
}

console.log('G2 線上查證（寫入 g2-30，G1 基準不變）…');
const result = await run_g2_verification({ online: true, force: force, max_tracks: 30 });
set_verify_engine('g2');
const report = build_g1_quality_report({ write: true });
console.log('\n========== G2 查證完成 ==========');
console.log('處理:', result.processed, '略過:', result.skipped);
console.log('請求:', result.progress.stats.network_requests);
console.log('快取命中:', result.progress.stats.cache_hits);
console.log('報告:', report.summary_zh.join('；'));
console.log('比較 G1: npm run verify:g2-compare');
console.log('==================================\n');
