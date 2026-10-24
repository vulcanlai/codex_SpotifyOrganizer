/**
 * G3-E 共用 prepare：批次輸入 JSON
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../../atomic_json.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { build_agent_input_doc } from './g3_e_prepare_track_input.js';
import { G3_D1_BATCH_DRAFTS_DIR } from '../g3_d/paths_d1.js';
import { FILE_G3_D4_MERGED_CANDIDATE_200 } from '../g3_d/paths_d4.js';

function load_d1_d34_suggestions() {
  /** @type {Record<string, object>} */
  const d1 = {};
  const files = fs.readdirSync(G3_D1_BATCH_DRAFTS_DIR).filter(function (f) {
    return f.endsWith('-imported.json');
  });
  for (let i = 0; i < files.length; i += 1) {
    const doc = JSON.parse(fs.readFileSync(path.join(G3_D1_BATCH_DRAFTS_DIR, files[i]), 'utf8'));
    for (let t = 0; t < doc.tracks.length; t += 1) {
      const row = doc.tracks[t];
      d1[row.track_id] = {
        primary_genre: row.genre_profile.primary_genre,
        language: row.language ? row.language.value : null,
        tier: row.confidence_tier,
        reason_zh: row.reason_zh,
      };
    }
  }
  const merged = JSON.parse(fs.readFileSync(FILE_G3_D4_MERGED_CANDIDATE_200, 'utf8'));
  /** @type {Record<string, object>} */
  const d34 = {};
  for (let m = 0; m < merged.tracks.length; m += 1) {
    const row = merged.tracks[m];
    d34[row.track_id] = {
      primary_genre: row.genre_profile.primary_genre,
      language: row.language ? row.language.value : null,
      tier: row.confidence_tier,
      source: row.source,
    };
  }
  return { d1: d1, d34: d34 };
}

/**
 * @param {object} wave_doc
 * @param {import('./g3_e_wave_spec.js').G3EWaveSpec} spec
 * @param {{ write?: boolean }} [opts]
 */
export function prepare_g3_e_batch_inputs(wave_doc, spec, opts) {
  const options = opts || {};
  const write = options.write !== false;
  const ev_all = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};
  const sugg = spec.include_review_only_suggestions ? load_d1_d34_suggestions() : null;

  /** @type {object[]} */
  const batch_docs = [];

  for (let b = 0; b < wave_doc.batches.length; b += 1) {
    const batch = wave_doc.batches[b];
    const payloads = [];
    for (let t = 0; t < batch.tracks.length; t += 1) {
      const meta = batch.tracks[t];
      const id = meta.track_id;
      const ev = ev_all[id];
      const meta_for_input = {
        cohort: meta.cohort,
        selection_reason_zh: meta.selection_reason_zh,
        review_only_suggestions: null,
      };
      if (sugg) {
        meta_for_input.review_only_suggestions = {
          note_zh: '僅供對照，非已確認事實',
          d1: sugg.d1[id] || null,
          d34: sugg.d34[id] || null,
        };
      }
      const input_doc = build_agent_input_doc(id, ev, meta_for_input);
      payloads.push(input_doc);
    }

    const doc = {
      schema_version: 1,
      batch_id: batch.batch_id,
      batch_index: batch.batch_index,
      purpose: spec.batch_input_purpose,
      infer_isolation: spec.include_review_only_suggestions
        ? 'e2_review_suggestions_optional'
        : 'e3_no_legacy_ai_in_input',
      agent_output_expected: '../agent-outputs/' + batch.batch_id + '-output.json',
      note_zh: '由 Cursor Agent 讀取後寫入 agent-outputs；npm 不會自動推理',
      tracks: payloads,
    };

    batch_docs.push(doc);
    if (write) {
      fs.mkdirSync(spec.batch_inputs_dir, { recursive: true });
      write_json_atomic(
        path.join(spec.batch_inputs_dir, batch.batch_id + '-input.json'),
        doc
      );
    }
  }

  return { batch_inputs: batch_docs };
}
