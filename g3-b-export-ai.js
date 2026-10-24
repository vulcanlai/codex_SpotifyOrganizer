/**
 * 僅重新匯出 G3-B AI 輸入（需已有 rule draft 或重跑管線）
 * npm run g3:b-export-ai
 */
import { run_g3_b_trial_pipeline } from './lib/classification/g3_b/pipeline.js';

run_g3_b_trial_pipeline({ write: true });
console.log('已更新 g3b-ai-input.json 與 cursor-g3b-input.md');
