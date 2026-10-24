/**
 * G3-B.1 AI 試驗品質報告
 */
import { build_g3_b_ai_trial_quality_report } from './lib/classification/g3_b/ai_trial_quality_report.js';
import { build_ai_pending_diagnostic } from './lib/classification/g3_b/ai_pending_diagnostic.js';

build_ai_pending_diagnostic({ write: true });
const report = build_g3_b_ai_trial_quality_report({ write: true });
console.log(JSON.stringify(report.counts, null, 2));
