/**
 * 建立／更新 G3 證據索引（離線）
 * npm run g3:evidence-build
 */
import { build_g3_evidence_index } from './lib/classification/g3_evidence/build_evidence_index.js';
import { FILE_G3_EVIDENCE_INDEX } from './lib/classification/g3_evidence/paths.js';

const result = build_g3_evidence_index({ write: true });
console.log('\n========== G3 證據索引 ==========');
console.log('曲目數:', result.index_doc.track_count);
console.log('覆蓋率摘要:', JSON.stringify(result.coverage_doc.coverage, null, 2));
console.log('衝突筆數:', result.conflicts_doc.conflict_count);
console.log('寫入:', FILE_G3_EVIDENCE_INDEX);
console.log('==================================\n');
