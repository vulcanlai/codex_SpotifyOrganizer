/**
 * G3-B.2 三十首離線重新評估
 * npm run g3:b2-offline-eval
 */
import { run_g3_b2_offline_eval } from './lib/classification/g3_b/run_b2_offline_eval.js';
import { G3_B2_TRIAL_DIR } from './lib/classification/g3_b/paths_b2.js';

const result = run_g3_b2_offline_eval({ write: true });
console.log('\n========== G3-B.2 離線評估 ==========');
result.summary.summary_zh.forEach(function (line) {
  console.log('-', line);
});
console.log('佇列狀態:', JSON.stringify(result.summary.queue_state_counts));
console.log('輸出:', G3_B2_TRIAL_DIR);
console.log('=====================================\n');
