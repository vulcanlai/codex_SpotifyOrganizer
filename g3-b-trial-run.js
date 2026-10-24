/**
 * G3-B 30 首試驗管線（離線）
 * npm run g3:b-trial-run
 */
import { run_g3_b_trial_pipeline } from './lib/classification/g3_b/pipeline.js';
import { G3_B_TRIAL_DIR } from './lib/classification/g3_b/paths.js';

const result = run_g3_b_trial_pipeline({ write: true });
console.log('\n========== G3-B 試驗 ==========');
result.quality.summary_zh.forEach(function (line) {
  console.log('-', line);
});
console.log('kind 統計:', JSON.stringify(result.quality.classification_kind_counts));
console.log('輸出目錄:', G3_B_TRIAL_DIR);
console.log('================================\n');
