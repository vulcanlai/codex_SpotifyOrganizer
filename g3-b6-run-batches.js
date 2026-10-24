/**
 * G3-B.6 十批匯入
 */
import fs from 'fs';
import path from 'path';
import { import_g3_b3_batch_from_file } from './lib/classification/g3_b/batch_import.js';
import {
  FILE_G3_B5_BATCH_PLAN,
  FILE_G3_B5_BATCH_PROGRESS,
  G3_B6_CURSOR_DRAFTS_DIR,
  G3_B6_BATCH_DRAFTS_DIR,
  FILE_G3_B6_BATCH_IMPORT_LOG,
  FILE_G3_B6_EXECUTION_LOG,
  G3_B6_TRIAL_DIR,
} from './lib/classification/g3_b/paths_b6.js';

fs.mkdirSync(G3_B6_TRIAL_DIR, { recursive: true });
fs.mkdirSync(G3_B6_BATCH_DRAFTS_DIR, { recursive: true });

const plan = JSON.parse(fs.readFileSync(FILE_G3_B5_BATCH_PLAN, 'utf8'));
let progress = JSON.parse(fs.readFileSync(FILE_G3_B5_BATCH_PROGRESS, 'utf8'));
const log = { started_at: new Date().toISOString(), batches: [] };

const import_opts = {
  batch_drafts_dir: G3_B6_BATCH_DRAFTS_DIR,
  batch_import_log: FILE_G3_B6_BATCH_IMPORT_LOG,
  batch_progress_file: FILE_G3_B5_BATCH_PROGRESS,
};

for (let i = 0; i < plan.batches.length; i += 1) {
  const batch_id = plan.batches[i].batch_id;
  const draft = path.join(G3_B6_CURSOR_DRAFTS_DIR, batch_id + '.json');
  const out = import_g3_b3_batch_from_file(
    batch_id,
    draft,
    plan,
    progress,
    import_opts
  );
  progress = out.progress;
  log.batches.push({
    batch_id: batch_id,
    skipped: out.skipped,
    result: out.result || null,
  });
  const n = out.result ? out.result.imported_track_ids.length : 0;
  const f = out.result ? out.result.failed.length : 0;
  console.log(batch_id, out.skipped ? 'skipped' : 'done', 'ok=' + n, 'fail=' + f);
}

log.finished_at = new Date().toISOString();
fs.writeFileSync(FILE_G3_B6_EXECUTION_LOG, JSON.stringify(log, null, 2), 'utf8');
