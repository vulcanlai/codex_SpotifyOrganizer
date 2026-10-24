/**
 * npm run classify:ai-export-phase-e
 */
import { export_phase_e_sample } from './lib/classification/phase_e_export.js';
import { snapshot_classification_data } from './lib/classification/snapshot_classification.js';

function main() {
  snapshot_classification_data('pre-phase-e-' + Date.now());
  const result = export_phase_e_sample({ write: true });
  if (!result.ok) {
    console.error(result.reason || '無法匯出 phase-e 樣本');
    console.error('符合條件池：', result.selection && result.selection.eligible_count);
    process.exit(1);
  }
  console.log('\n========== phase-e-100 樣本 ==========');
  console.log('樣本 ID：', result.sample_doc.sample_id);
  console.log('曲目數：', result.sample_doc.track_count);
  console.log('排除 v2 30 首');
  console.log('符合條件池：', result.selection.eligible_count);
  console.log('Cursor 分批：backup/classification/ai-test/phase-e-100/cursor-chunks/');
  console.log('======================================\n');
}

main();
