/**
 * npm run classify:ai-archive-v1
 */
import { archive_ai_v1_records } from './lib/classification/ai_archive_v1.js';

const result = archive_ai_v1_records();
console.log('\n========== AI v1 封存 ==========');
if (result.archived) {
  console.log('已封存：', result.copied.join(', '));
} else {
  console.log('略過：', result.reason || '已存在');
}
console.log('================================\n');
