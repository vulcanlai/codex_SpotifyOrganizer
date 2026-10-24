/**
 * 執行 G1 外部查證（預設離線；需 --online 才連 MusicBrainz）
 * npm run verify:g1-run
 * npm run verify:g1-run -- --online
 * npm run verify:g1-run -- --online --resume
 */
import { run_g1_verification } from './lib/enrichment/external/run_verification.js';
import { set_verify_engine } from './lib/enrichment/external/verify_data_dir.js';

set_verify_engine('g1');
import { build_g1_quality_report } from './lib/enrichment/external/quality_report.js';

const args = process.argv.slice(2);
const online = args.indexOf('--online') >= 0;
const force = args.indexOf('--force') >= 0;

if (!online) {
  console.log('預設離線模式。請加上 --online 才會連線查證 MusicBrainz（不會呼叫 Spotify API）。');
  const preview = await run_g1_verification({ online: false });
  console.log('預覽曲目:', preview.previews.length);
  process.exit(0);
}

console.log('G1 線上查證啟動（MusicBrainz only，最多 30 首）…');
const result = await run_g1_verification({ online: true, force: force, max_tracks: 30 });
const report = build_g1_quality_report({ write: true });
console.log('\n========== G1 查證完成 ==========');
console.log('本次處理:', result.processed);
console.log('略過（已有結果）:', result.skipped);
console.log('網路請求:', result.progress.stats.network_requests);
console.log('快取命中:', result.progress.stats.cache_hits);
console.log('報告摘要:', report.summary_zh.join('；'));
console.log('==================================\n');
