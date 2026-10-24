/**
 * 離線預覽 G1 查證計畫（不發出網路請求）
 * npm run verify:g1-preview
 */
import { run_g1_verification } from './lib/enrichment/external/run_verification.js';
import { set_verify_engine } from './lib/enrichment/external/verify_data_dir.js';

set_verify_engine('g1');

const result = await run_g1_verification({ online: false });
console.log('\n========== G1 離線預覽 ==========');
console.log('預覽曲目數:', result.previews.length);
console.log('已略過（已有結果）:', result.skipped);
for (let i = 0; i < Math.min(5, result.previews.length); i += 1) {
  const p = result.previews[i];
  console.log('-', p.spotify_id, p.title, '| ISRC:', p.isrc || '無');
}
if (result.previews.length > 5) {
  console.log('… 其餘', result.previews.length - 5, '首見 progress / sample 檔');
}
console.log('若要連線查證：npm run verify:g1-run -- --online');
console.log('==================================\n');
