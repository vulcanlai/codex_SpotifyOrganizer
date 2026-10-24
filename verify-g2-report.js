/**
 * G2 品質報告
 */
import { set_verify_engine } from './lib/enrichment/external/verify_data_dir.js';
import { build_g1_quality_report } from './lib/enrichment/external/quality_report.js';
import { file_verify_quality_report } from './lib/enrichment/external/verify_data_dir.js';

set_verify_engine('g2');
const report = build_g1_quality_report({ write: true });
console.log('\n========== G2 品質報告 ==========');
report.summary_zh.forEach(function (line) {
  console.log(line);
});
console.log('寫入:', file_verify_quality_report());
console.log('==================================\n');
