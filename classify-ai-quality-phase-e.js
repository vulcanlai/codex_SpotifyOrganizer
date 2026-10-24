/**
 * npm run classify:ai-quality-phase-e
 */
import { build_phase_e_quality_report } from './lib/classification/ai_quality_report.js';

function main() {
  const report = build_phase_e_quality_report({ write: true });
  console.log('\n========== phase-e 品質報告 ==========');
  console.log(JSON.stringify(report.classification_status, null, 2));
  console.log('主曲風分布：', report.primary_genre_distribution);
  console.log('可信度：', report.confidence_tier_distribution);
  console.log('寫入：backup/classification/ai-test/phase-e-100/quality-report.json');
  console.log('======================================\n');
}

main();
