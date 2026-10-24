/**
 * G3-B.3 批次匯入（續跑、不覆寫 G3-B.1）
 * npm run g3:b3-batch-import -- <batch_id> <draft.json>
 */
import fs from 'node:fs';
import { import_g3_b3_batch_from_file } from './lib/classification/g3_b/batch_import.js';
import { FILE_G3_B3_BATCH_PLAN, FILE_G3_B3_BATCH_PROGRESS } from './lib/classification/g3_b/paths_b3.js';

const batch_id = process.argv[2];
const draft = process.argv[3];
if (!batch_id || !draft) {
  console.error('用法: npm run g3:b3-batch-import -- g3b3-batch-01 path/to/draft.json');
  process.exit(1);
}

const plan = JSON.parse(fs.readFileSync(FILE_G3_B3_BATCH_PLAN, 'utf8'));
const progress = JSON.parse(fs.readFileSync(FILE_G3_B3_BATCH_PROGRESS, 'utf8'));

const out = import_g3_b3_batch_from_file(batch_id, draft, plan, progress);
console.log(JSON.stringify(out, null, 2));
