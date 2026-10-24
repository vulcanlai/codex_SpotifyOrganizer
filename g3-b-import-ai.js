/**
 * 匯入 G3-B AI 草稿（僅寫入 g3-b-trial-30/ai-classification-draft.json）
 * node g3-b-import-ai.js [path-to-draft.json]
 */
import path from 'node:path';
import { import_g3_b_ai_draft_from_file } from './lib/classification/g3_b/import_ai_draft.js';
import { FILE_G3_B_AI_DRAFT_IMPORTED } from './lib/classification/g3_b/paths.js';

const input =
  process.argv[2] ||
  path.join('backup', 'classification', 'g3-b-trial-30', 'ai-classification-draft.json');

const out = import_g3_b_ai_draft_from_file(input);
console.log('已驗證並寫入', FILE_G3_B_AI_DRAFT_IMPORTED, '曲目數', out.tracks.length);
try {
  const { build_g3_b_ai_trial_quality_report } = await import(
    './lib/classification/g3_b/ai_trial_quality_report.js'
  );
  build_g3_b_ai_trial_quality_report({ write: true });
  console.log('已更新 ai-trial-quality-report.json');
} catch (err) {
  console.warn('品質報告略過:', err.message);
}
