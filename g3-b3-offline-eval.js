/**
 * G3-B.3 離線試驗
 */
import { run_g3_b3_offline_eval } from './lib/classification/g3_b/run_b3_offline_eval.js';
import { G3_B3_TRIAL_DIR } from './lib/classification/g3_b/paths_b3.js';

const r = run_g3_b3_offline_eval({ write: true });
console.log('\n========== G3-B.3 ==========');
r.summary.summary_zh.forEach(function (line) {
  console.log('-', line);
});
console.log('輸出:', G3_B3_TRIAL_DIR);
console.log('============================\n');
