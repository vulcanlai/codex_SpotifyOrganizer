/**
 * 建立 phase-f-20 品質驗證抽樣（可重現）
 * npm run classify:quality-audit-build-phase-f
 */
import { build_phase_f_sample } from './lib/classification/phase_f_sample.js';
import { build_quality_audit_report } from './lib/classification/quality_audit_report.js';
import {
  empty_verification_doc,
  load_quality_verification,
} from './lib/classification/quality_audit_store.js';
import { write_json_atomic } from './lib/atomic_json.js';
import { FILE_PHASE_F_VERIFICATION } from './lib/classification/quality_audit_paths.js';
import { FILE_PHASE_F_DIR } from './lib/classification/quality_audit_paths.js';

const result = build_phase_f_sample({ write: true });

const existing = load_quality_verification();
if (
  !existing.updated_at ||
  (result.sample_doc.sample_id &&
    existing.sample_id !== result.sample_doc.sample_id)
) {
  write_json_atomic(
    FILE_PHASE_F_VERIFICATION,
    empty_verification_doc(result.sample_doc)
  );
}

const report = build_quality_audit_report({ write: true });

console.log('\n========== phase-f 品質抽樣 ==========');
console.log('sample_id:', result.sample_doc.sample_id);
console.log('曲目數:', result.sample_doc.track_count);
console.log('分布:', JSON.stringify(result.selection.actual_distribution, null, 2));
console.log('說明:', result.selection.selection_notes.join(' '));
console.log('目錄:', FILE_PHASE_F_DIR);
console.log(
  '人工驗證:',
  report.rates.has_human_verification ? '已有' : '尚無（預期）'
);
console.log('========================================\n');
