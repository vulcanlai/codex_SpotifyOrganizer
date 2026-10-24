/**
 * npm run classify:ai-import
 */
import { import_ai_candidates } from './lib/classification/ai_import.js';
import { AiImportError } from './lib/classification/ai_import.js';

function main() {
  try {
    const result = import_ai_candidates();
    console.log('\n========== AI 候選匯入 ==========');
    if (result.idempotent) {
      console.log('與既有候選相同，略過重複寫入（idempotent）。');
    } else {
      console.log('匯入成功。');
    }
    console.log('樣本 ID：', result.sample_doc.sample_id);
    console.log('候選數：', result.candidates_doc.candidates.length);
    console.log('尚未自動寫入 manual-overrides 或正式分類。');
    console.log('==================================\n');
  } catch (err) {
    if (err instanceof AiImportError) {
      console.error('匯入失敗：', err.message);
      process.exit(1);
    }
    throw err;
  }
}

main();
