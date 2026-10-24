/**
 * npm run classify:ai-merge-phase-e
 */
import { merge_phase_e_partial_candidates } from './lib/classification/phase_e_import.js';

function main() {
  const r = merge_phase_e_partial_candidates({ write: true });
  console.log('\n========== partial 合併 ==========');
  console.log('合併曲目數：', r.merged_count);
  console.log('來源檔：', r.sources.join(', ') || '（無）');
  console.log('草稿：backup/classification/ai-test/phase-e-100/ai-candidates.json');
  console.log('==================================\n');
}

main();
