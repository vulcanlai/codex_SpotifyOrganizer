/**
 * 備份並清除正式試驗目錄中的 mock 執行期資料（不刪 sample-30）
 * npm run verify:g1-clean-mock-runtime
 */
import { reset_g1_trial_runtime_if_mock } from './lib/enrichment/external/g1_trial_runtime.js';

const dry = process.argv.indexOf('--dry-run') >= 0;
const result = reset_g1_trial_runtime_if_mock({ dry_run: dry });

console.log('\n========== G1 mock 執行期清理 ==========');
if (result.dry_run) {
  console.log('dry-run：將重設', (result.would_reset || []).join(', ') || '（無）');
} else if (result.reset) {
  console.log('已備份至:', result.backup_dir);
  console.log('動作:', result.actions.join(' · '));
} else {
  console.log('未變更:', result.reason);
}
console.log('========================================\n');
