/**
 * npm run classify:ai-export -- --count=30
 */
import { export_ai_test_sample } from './lib/classification/ai_export.js';
import { AiExportError } from './lib/classification/ai_export.js';

function parse_count(argv) {
  const args = argv || [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.indexOf('--count=') === 0) {
      const n = parseInt(a.slice('--count='.length), 10);
      if (Number.isFinite(n) && n > 0) {
        return n;
      }
    }
  }
  return 30;
}

function main() {
  const count = parse_count(process.argv.slice(2));
  try {
    const result = export_ai_test_sample({ count });
    console.log('\n========== AI 測試樣本匯出 ==========');
    console.log('樣本 ID：', result.sample_doc.sample_id);
    console.log('曲目數：', result.sample_doc.track_count);
    console.log('符合條件池：', result.selection.eligible_count);
    console.log('輸出：backup/classification/ai-test/');
    console.log('======================================\n');
  } catch (err) {
    if (err instanceof AiExportError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

main();
