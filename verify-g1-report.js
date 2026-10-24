/**
 * 重新產生 G1 品質報告
 * npm run verify:g1-report
 */
import { build_g1_quality_report } from './lib/enrichment/external/quality_report.js';
import { file_g1_quality_report } from './lib/enrichment/external/g1_path_resolve.js';
import { set_verify_engine } from './lib/enrichment/external/verify_data_dir.js';

set_verify_engine('g1');

const report = build_g1_quality_report({ write: true });
console.log('\n========== G1 品質報告 ==========');
report.summary_zh.forEach(function (line) {
  console.log(line);
});
console.log('寫入:', file_g1_quality_report());
console.log('==================================\n');
