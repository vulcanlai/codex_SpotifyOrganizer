/**
 * 追蹤歌單手動匯入 CLI（離線，不需 OAuth）
 * 使用方式：npm run import
 */
import {
  run_manual_import,
  print_import_summary,
} from './lib/import/run_manual_import.js';

console.log('開始掃描 imports/ 文字檔（離線匯入，不修改 Spotify）…\n');

try {
  const result = run_manual_import();
  print_import_summary(result);
  if (!result.import_summary.library_data_complete) {
    process.exitCode = 1;
  }
} catch (err) {
  console.error('匯入失敗：', err && err.message ? err.message : err);
  process.exit(1);
}
