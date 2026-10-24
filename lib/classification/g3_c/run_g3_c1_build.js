/**
 * G3-C.1 離線建置（統一檢視 + 任務 + 預覽覆蓋）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { build_unified_classification_view } from './build_unified_view.js';
import { build_g3_c1_field_evidence_tasks } from './g3_c1_field_tasks.js';
import { compute_g3_unified_playlist_preview } from './g3_smart_playlist_preview.js';
import { PREVIEW_MODE_BALANCED } from '../preview_settings.js';
import {
  G3_C1_DIR,
  FILE_G3_C1_FIELD_TASKS,
  FILE_G3_C1_PREVIEW_COVERAGE,
} from './paths_c1.js';

/**
 * @param {{ write?: boolean }} [opts]
 */
export function run_g3_c1_build(opts) {
  const options = opts || {};
  const write = options.write !== false;

  const built = build_unified_classification_view({ write: write });
  const ev = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8'));
  const tasks = build_g3_c1_field_evidence_tasks(ev.tracks || {});
  const preview = compute_g3_unified_playlist_preview({}, PREVIEW_MODE_BALANCED, built.doc);

  let needs_evidence_tracks = 0;
  let human_required = 0;
  const track_keys = Object.keys(built.doc.tracks || {});
  for (let n = 0; n < track_keys.length; n += 1) {
    const tr = built.doc.tracks[track_keys[n]];
    if (tr.in_g3_sample_100 && tr.auto_review_status === 'needs_evidence') {
      needs_evidence_tracks += 1;
    }
  }

  for (let t = 0; t < tasks.length; t += 1) {
    if (tasks[t].requires_human) {
      human_required += 1;
    }
  }

  const task_doc = {
    schema_version: 1,
    generated_at: built.doc.generated_at,
    task_count: tasks.length,
    needs_evidence_track_count: needs_evidence_tracks,
    human_required_task_count: human_required,
    tasks: tasks,
  };

  if (write) {
    if (!fs.existsSync(G3_C1_DIR)) {
      fs.mkdirSync(G3_C1_DIR, { recursive: true });
    }
    write_json_atomic(FILE_G3_C1_FIELD_TASKS, task_doc);
    write_json_atomic(FILE_G3_C1_PREVIEW_COVERAGE, {
      schema_version: 1,
      generated_at: built.doc.generated_at,
      balanced_empty_filter: preview,
    });
  }

  return {
    summary: built.summary,
    task_count: tasks.length,
    needs_evidence_tracks: needs_evidence_tracks,
    preview: preview,
  };
}
