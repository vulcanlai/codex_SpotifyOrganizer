/**
 * G3-B.3 批次匯入（單首失敗不毀整批；不覆寫 G3-B.1）
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../../atomic_json.js';
import { validate_g3_b_ai_draft } from './validate_ai_draft.js';
import { import_g3_b_ai_draft } from './import_ai_draft.js';
import { G3BImportError } from './import_ai_draft.js';
import {
  G3_B3_BATCH_DRAFTS_DIR,
  FILE_G3_B3_BATCH_IMPORT_LOG,
  G3_B3_TRIAL_DIR,
} from './paths_b3.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { is_batch_completed, apply_batch_import_result } from './batch_plan.js';
import { FILE_G3_B3_BATCH_PROGRESS } from './paths_b3.js';

function load_evidence_by_id() {
  const p = file_g3_evidence_index();
  if (!fs.existsSync(p)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')).tracks || {};
}

/**
 * @param {object} batch_doc tracks array subset
 * @param {{ allowed_track_ids: string[], output_path?: string }} opts
 */
export function import_batch_tracks_safe(batch_doc, opts) {
  const options = opts || {};
  const evidence_by_id = load_evidence_by_id();
  const imported = [];
  const failed = [];

  const tracks = batch_doc.tracks || [];
  for (let i = 0; i < tracks.length; i += 1) {
    const row = tracks[i];
    try {
      if (
        options.allowed_track_ids &&
        options.allowed_track_ids.indexOf(row.track_id) < 0
      ) {
        throw new G3BImportError('不在批次允許清單：' + row.track_id);
      }
      validate_g3_b_ai_draft(
        { tracks: [row] },
        {
          evidence_by_id: evidence_by_id,
          allowed_track_ids: [row.track_id],
        }
      );
      imported.push(row.track_id);
    } catch (err) {
      failed.push({
        track_id: row.track_id,
        error: err.message,
      });
    }
  }

  let written_path = null;
  if (imported.length && options.output_path) {
    const out = import_g3_b_ai_draft(
      {
        schema_version: batch_doc.schema_version || 1,
        source: batch_doc.source || 'g3_b3_batch',
        tracks: tracks.filter(function (t) {
          return imported.indexOf(t.track_id) >= 0;
        }),
      },
      {
        write: false,
        allowed_track_ids: options.allowed_track_ids,
      }
    );
    fs.mkdirSync(path.dirname(options.output_path), { recursive: true });
    write_json_atomic(options.output_path, out);
    written_path = options.output_path;
  }

  return {
    imported_track_ids: imported,
    failed: failed,
    output_path: written_path,
    batch_failed: imported.length === 0 && failed.length > 0,
  };
}

/**
 * @param {string} batch_id
 * @param {string} draft_file
 * @param {object} plan
 * @param {object} progress
 */
/**
 * @param {string} batch_id
 * @param {string} draft_file
 * @param {object} plan
 * @param {object} progress
 * @param {{ batch_drafts_dir?: string, batch_import_log?: string, batch_progress_file?: string }} [import_opts]
 */
export function import_g3_b3_batch_from_file(batch_id, draft_file, plan, progress, import_opts) {
  const io = import_opts || {};
  const drafts_dir = io.batch_drafts_dir || G3_B3_BATCH_DRAFTS_DIR;
  const import_log_path = io.batch_import_log || FILE_G3_B3_BATCH_IMPORT_LOG;
  const progress_file = io.batch_progress_file || FILE_G3_B3_BATCH_PROGRESS;
  if (is_batch_completed(progress, batch_id)) {
    return {
      skipped: true,
      reason: 'batch_already_completed',
      progress: progress,
    };
  }

  const batch_row = (plan.batches || []).find(function (b) {
    return b.batch_id === batch_id;
  });
  if (!batch_row) {
    throw new G3BImportError('未知 batch_id：' + batch_id);
  }

  if (!fs.existsSync(draft_file)) {
    throw new G3BImportError('找不到草稿：' + draft_file);
  }

  const doc = JSON.parse(fs.readFileSync(draft_file, 'utf8'));
  const output_path = path.join(drafts_dir, batch_id + '-imported.json');

  const result = import_batch_tracks_safe(doc, {
    allowed_track_ids: batch_row.track_ids,
    output_path: output_path,
  });

  const next_progress = apply_batch_import_result(progress, batch_id, result);

  const log_entry = {
    batch_id: batch_id,
    at: new Date().toISOString(),
    draft_file: draft_file,
    result: result,
  };

  let log = { entries: [] };
  if (fs.existsSync(import_log_path)) {
    log = JSON.parse(fs.readFileSync(import_log_path, 'utf8'));
  }
  log.entries.push(log_entry);
  fs.mkdirSync(path.dirname(import_log_path), { recursive: true });
  write_json_atomic(import_log_path, log);
  write_json_atomic(progress_file, next_progress);

  return {
    skipped: false,
    result: result,
    progress: next_progress,
  };
}
