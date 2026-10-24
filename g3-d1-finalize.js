/**
 * G3-D.1 合併報告 + C1 重建 + 預覽影響
 */
import { build_g3_d1_merged_quality_report } from './lib/classification/g3_d/merged_quality_report_d1.js';
import { run_g3_c1_build } from './lib/classification/g3_c/run_g3_c1_build.js';
import { compute_g3_d1_preview_impact } from './lib/classification/g3_d/g3_d1_preview_impact.js';

const merged = build_g3_d1_merged_quality_report({ write: true });
console.log('merged', JSON.stringify(merged.counts, null, 2));
const c1 = run_g3_c1_build({ write: true });
console.log('c1', JSON.stringify(c1.summary, null, 2));
const impact = compute_g3_d1_preview_impact({ write: true });
console.log('preview_impact', JSON.stringify(impact, null, 2));
