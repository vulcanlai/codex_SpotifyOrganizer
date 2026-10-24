/**
 * npm run classify:ai-import-v2
 */
import { import_ai_candidates_v2 } from './lib/classification/ai_import_v2.js';
import { AiImportV2Error } from './lib/classification/ai_import_v2.js';

function main() {
  try {
    const result = import_ai_candidates_v2();
    console.log('\n========== AI v2 候選匯入 ==========');
    if (result.idempotent) {
      console.log('與既有 v2 候選相同，略過重複寫入（idempotent）。');
    } else {
      console.log('匯入成功；v2 審核狀態已全部重置為新版待審核。');
    }
    console.log('樣本 ID：', result.sample_doc.sample_id);
    console.log('候選數：', result.candidates_doc.candidates.length);
    if (result.compare_summary) {
      console.log('與 v1 分類不同：', result.compare_summary.changed_count, '首');
      console.log('v2 主曲風 unknown：', result.compare_summary.unknown_primary_v2);
    }
    console.log('未修改 v1 候選／v1 審核／manual-overrides。');
    console.log('======================================\n');
  } catch (err) {
    if (err instanceof AiImportV2Error) {
      console.error('匯入失敗：', err.message);
      process.exit(1);
    }
    throw err;
  }
}

main();
