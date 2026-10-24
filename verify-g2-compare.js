/**
 * G1 vs G2 離線比較
 */
import { build_g1_g2_compare_report } from './lib/enrichment/external/g2_compare.js';
import { file_g2_compare_report } from './lib/enrichment/external/verify_data_dir.js';

const report = build_g1_g2_compare_report({ write: true });
console.log('\n========== G1 vs G2 ==========');
console.log('G1 matched:', report.g1.status_counts.matched || 0);
console.log('G2 matched:', report.g2.status_counts.matched || 0);
console.log('Δ matched:', report.delta.matched);
console.log('Δ error:', report.delta.error);
console.log('Δ 候選數:', report.delta.with_candidates);
console.log('Δ 請求:', report.delta.extra_network_requests);
console.log('寫入:', file_g2_compare_report());
console.log('==============================\n');
