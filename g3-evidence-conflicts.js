/**
 * G3 證據衝突列表（離線）
 * npm run g3:evidence-conflicts
 */
import fs from 'node:fs';
import { FILE_G3_CONFLICTS_REPORT } from './lib/classification/g3_evidence/paths.js';
import { build_g3_evidence_index } from './lib/classification/g3_evidence/build_evidence_index.js';

if (!fs.existsSync(FILE_G3_CONFLICTS_REPORT)) {
  build_g3_evidence_index({ write: true });
}

const doc = JSON.parse(fs.readFileSync(FILE_G3_CONFLICTS_REPORT, 'utf8'));
console.log('\n========== G3 衝突 ==========');
console.log('衝突筆數:', doc.conflict_count);
for (let i = 0; i < doc.conflicts.length; i += 1) {
  const c = doc.conflicts[i];
  console.log('-', c.title, c.track_id, JSON.stringify(c.conflict));
}
console.log('==============================\n');
