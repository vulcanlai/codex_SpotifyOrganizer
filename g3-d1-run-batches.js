/**
 * G3-D.1 批次匯入（可續跑）
 */
import fs from 'fs';
import path from 'path';
import { import_g3_b3_batch_from_file } from './lib/classification/g3_b/batch_import.js';
import {
  FILE_G3_D1_BATCH_PLAN,
  FILE_G3_D1_BATCH_PROGRESS,
  G3_D1_CURSOR_DRAFTS_DIR,
  G3_D1_BATCH_DRAFTS_DIR,
  FILE_G3_D1_BATCH_IMPORT_LOG,
  FILE_G3_D1_EXECUTION_LOG,
  G3_D1_WAVE_DIR,
} from './lib/classification/g3_d/paths_d1.js';
import { run_g3_d1_quality_checkpoint } from './lib/classification/g3_d/g3_d1_quality_checkpoint.js';

fs.mkdirSync(G3_D1_WAVE_DIR, { recursive: true });
fs.mkdirSync(G3_D1_BATCH_DRAFTS_DIR, { recursive: true });

const plan = JSON.parse(fs.readFileSync(FILE_G3_D1_BATCH_PLAN, 'utf8'));
let progress = JSON.parse(fs.readFileSync(FILE_G3_D1_BATCH_PROGRESS, 'utf8'));
const log = { started_at: new Date().toISOString(), batches: [] };

const import_opts = {
  batch_drafts_dir: G3_D1_BATCH_DRAFTS_DIR,
  batch_import_log: FILE_G3_D1_BATCH_IMPORT_LOG,
  batch_progress_file: FILE_G3_D1_BATCH_PROGRESS,
};

for (let i = 0; i < plan.batches.length; i += 1) {
  const batch_id = plan.batches[i].batch_id;
  const draft = path.join(G3_D1_CURSOR_DRAFTS_DIR, batch_id + '.json');
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

  const batch_index = plan.batches[i].batch_index;
  if (batch_index % 10 === 0 && !out.skipped && n > 0) {
    const qc = run_g3_d1_quality_checkpoint(batch_index, { write: true });
    console.log('QC through batch', batch_index, qc.systemic_issues);
    if (qc.stop_recommended) {
      console.error('品質檢查建議停止後續批次');
      break;
    }
  }
}

log.finished_at = new Date().toISOString();
fs.writeFileSync(FILE_G3_D1_EXECUTION_LOG, JSON.stringify(log, null, 2), 'utf8');
