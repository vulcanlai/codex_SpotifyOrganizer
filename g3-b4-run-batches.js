/**
 * G3-B.4 執行四批匯入
 */
import fs from 'fs';
import path from 'path';
import { import_g3_b3_batch_from_file } from './lib/classification/g3_b/batch_import.js';
import { build_g3_b4_merged_quality_report } from './lib/classification/g3_b/merged_quality_report.js';
import {
  FILE_G3_B3_BATCH_PLAN,
  FILE_G3_B3_BATCH_PROGRESS,
} from './lib/classification/g3_b/paths_b3.js';
import {
  G3_B4_CURSOR_DRAFTS_DIR,
  FILE_G3_B4_EXECUTION_LOG,
  G3_B4_TRIAL_DIR,
} from './lib/classification/g3_b/paths_b4.js';

const batches = [
  'g3b3-batch-01',
  'g3b3-batch-02',
  'g3b3-batch-03',
  'g3b3-batch-04',
];

fs.mkdirSync(G3_B4_TRIAL_DIR, { recursive: true });

const plan = JSON.parse(fs.readFileSync(FILE_G3_B3_BATCH_PLAN, 'utf8'));
let progress = JSON.parse(fs.readFileSync(FILE_G3_B3_BATCH_PROGRESS, 'utf8'));
const log = { started_at: new Date().toISOString(), batches: [] };

for (let i = 0; i < batches.length; i += 1) {
  const batch_id = batches[i];
  const draft = path.join(G3_B4_CURSOR_DRAFTS_DIR, batch_id + '.json');
  const out = import_g3_b3_batch_from_file(batch_id, draft, plan, progress);
  progress = out.progress;
  log.batches.push({
    batch_id: batch_id,
    skipped: out.skipped,
    result: out.result || null,
  });
  console.log(batch_id, out.skipped ? 'skipped' : 'imported', out.result?.imported_track_ids?.length || 0);
}

log.finished_at = new Date().toISOString();
fs.writeFileSync(FILE_G3_B4_EXECUTION_LOG, JSON.stringify(log, null, 2), 'utf8');

const report = build_g3_b4_merged_quality_report({ write: true });
console.log('merged report ai_processed', report.counts.ai_processed_total);
