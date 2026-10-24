/**
 * G3 證據覆蓋率（離線；若索引不存在則先提示 build）
 * npm run g3:evidence-coverage
 */
import fs from 'node:fs';
import {
  FILE_G3_COVERAGE_SUMMARY,
  FILE_G3_EVIDENCE_INDEX,
} from './lib/classification/g3_evidence/paths.js';
import { build_g3_evidence_index } from './lib/classification/g3_evidence/build_evidence_index.js';

if (!fs.existsSync(FILE_G3_EVIDENCE_INDEX)) {
  console.log('尚未建立索引，正在離線重建…');
  build_g3_evidence_index({ write: true });
}

const doc = JSON.parse(fs.readFileSync(FILE_G3_COVERAGE_SUMMARY, 'utf8'));
console.log('\n========== G3 覆蓋率 ==========');
console.log('產生時間:', doc.generated_at);
console.log('曲目總數:', doc.track_count);
console.log(JSON.stringify(doc.coverage, null, 2));
console.log('================================\n');
