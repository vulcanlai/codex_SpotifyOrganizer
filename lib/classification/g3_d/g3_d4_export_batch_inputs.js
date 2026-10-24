/**
 * G3-D.4 批次輸入（evidence + D.1/D.2 脈絡）
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../../atomic_json.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { main_to_allowed_subgenres_map } from './g3_d3_agent_repair_drafts.js';
import { G3_D1_BATCH_DRAFTS_DIR, G3_D1_BATCH_INPUTS_DIR } from './paths_d1.js';
import { FILE_G3_D2_QUALITY_OVERLAY } from './paths_d2.js';
import { G3_D4_BATCH_INPUTS_DIR } from './paths_d4.js';

function load_d1_by_id() {
  /** @type {Record<string, object>} */
  const by_id = {};
  const files = fs.readdirSync(G3_D1_BATCH_DRAFTS_DIR).filter(function (f) {
    return f.endsWith('-imported.json');
  });
  for (let i = 0; i < files.length; i += 1) {
    const doc = JSON.parse(fs.readFileSync(path.join(G3_D1_BATCH_DRAFTS_DIR, files[i]), 'utf8'));
    for (let t = 0; t < doc.tracks.length; t += 1) {
      by_id[doc.tracks[t].track_id] = doc.tracks[t];
    }
  }
  return by_id;
}

function load_payload_map() {
  /** @type {Record<string, object>} */
  const map = {};
  const files = fs.readdirSync(G3_D1_BATCH_INPUTS_DIR).filter(function (f) {
    return f.endsWith('-input.json');
  });
  for (let i = 0; i < files.length; i += 1) {
    const doc = JSON.parse(fs.readFileSync(path.join(G3_D1_BATCH_INPUTS_DIR, files[i]), 'utf8'));
    const payloads = doc.evidence_payloads || [];
    for (let p = 0; p < payloads.length; p += 1) {
      map[payloads[p].track_id] = payloads[p];
    }
  }
  return map;
}

/**
 * @param {object} reconcile_doc
 * @param {{ write?: boolean }} [opts]
 */
export function export_g3_d4_batch_inputs(reconcile_doc, opts) {
  const options = opts || {};
  const write = options.write !== false;
  const d1_by = load_d1_by_id();
  const payloads = load_payload_map();
  const ev_tracks = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};
  const ov_by = {};
  if (fs.existsSync(FILE_G3_D2_QUALITY_OVERLAY)) {
    const ov = JSON.parse(fs.readFileSync(FILE_G3_D2_QUALITY_OVERLAY, 'utf8'));
    for (let q = 0; q < ov.tracks.length; q += 1) {
      ov_by[ov.tracks[q].track_id] = ov.tracks[q];
    }
  }

  const main_map = main_to_allowed_subgenres_map();
  const written = [];

  for (let b = 0; b < reconcile_doc.batches.length; b += 1) {
    const batch = reconcile_doc.batches[b];
    const evidence_payloads = [];
    for (let t = 0; t < batch.track_ids.length; t += 1) {
      const id = batch.track_ids[t];
      const d1 = d1_by[id] || null;
      evidence_payloads.push({
        track_id: id,
        evidence_payload: payloads[id] || null,
        evidence_index: ev_tracks[id] || null,
        d1_imported_suggestion: d1
          ? {
              primary_genre: d1.genre_profile.primary_genre,
              subgenres: d1.genre_profile.subgenres,
              language: d1.language ? d1.language.value : null,
              confidence_tier: d1.confidence_tier,
              reason_zh: d1.reason_zh,
              note_zh: '僅供對照；非標準答案',
            }
          : null,
        d2_quality: ov_by[id]
          ? {
              quality_status: ov_by[id].quality_status,
              quality_issues: ov_by[id].quality_issues || [],
            }
          : null,
      });
    }

    const doc = {
      schema_version: 1,
      source: 'g3_d4_batch_input',
      batch_id: batch.batch_id,
      batch_index: batch.batch_index,
      model_note:
        'G3-D.4：Cursor Agent 逐首填寫 cursor-agent-drafts/' +
        batch.batch_id +
        '.json；不得使用 g3:d1-generate-drafts',
      main_to_allowed_subgenres: main_map,
      evidence_payloads: evidence_payloads,
    };

    if (write) {
      fs.mkdirSync(G3_D4_BATCH_INPUTS_DIR, { recursive: true });
      const out_path = path.join(G3_D4_BATCH_INPUTS_DIR, batch.batch_id + '-input.json');
      write_json_atomic(out_path, doc);
      written.push(out_path);
    }
  }

  return { batch_count: reconcile_doc.batches.length, written_paths: written };
}
