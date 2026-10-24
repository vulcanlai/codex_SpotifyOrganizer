/**
 * G3-E.1 prepare：輸入資料包（不含舊分類為事實）
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../../atomic_json.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { main_to_allowed_subgenres_map } from '../g3_d/g3_d3_agent_repair_drafts.js';
import { stable_json_hash } from './g3_e1_hash.js';
import { G3_E1_INPUTS_DIR } from './paths_e1.js';

function facts_from_evidence(ev) {
  /** @type {object[]} */
  const out = [];
  const facts = ev.facts || [];
  for (let i = 0; i < facts.length; i += 1) {
    const f = facts[i];
    if (f.is_direct_fact && !f.is_ai_candidate) {
      out.push({
        field: f.field,
        value: f.value,
        source: f.source,
        note: f.note || null,
      });
    }
  }
  return out;
}

/**
 * @param {object} sample_doc
 * @param {{ write?: boolean }} [opts]
 */
export function prepare_g3_e1_inputs(sample_doc, opts) {
  const options = opts || {};
  const write = options.write !== false;
  const ev_all = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};
  const main_map = main_to_allowed_subgenres_map();

  /** @type {object[]} */
  const manifest_entries = [];

  for (let i = 0; i < sample_doc.tracks.length; i += 1) {
    const meta = sample_doc.tracks[i];
    const id = meta.track_id;
    const ev = ev_all[id];
    const identity = ev && ev.identity ? ev.identity : {};

    const input_doc = {
      schema_version: 1,
      track_id: id,
      purpose: 'g3_e1_agent_infer_input',
      identity: {
        title: identity.title,
        artists: identity.artists,
        album_name: identity.album_name,
        isrc: identity.isrc,
        release_date: identity.release_date,
        metadata_status: identity.metadata_status,
        enrichment_cache_complete: identity.enrichment_cache_complete,
      },
      sourced_evidence_facts: facts_from_evidence(ev || {}),
      main_to_allowed_subgenres: main_map,
      prior_suggestions_for_review_only: {
        note_zh: '以下僅供對照，不得視為已確認事實',
        d1_available: false,
        d34_available: false,
      },
      cohort: meta.cohort,
      selection_reason_zh: meta.selection_reason_zh,
    };

    const input_hash = stable_json_hash(input_doc);
    input_doc.input_hash = input_hash;

    manifest_entries.push({
      track_id: id,
      input_hash: input_hash,
      input_file: 'inputs/' + id + '-input.json',
    });

    if (write) {
      fs.mkdirSync(G3_E1_INPUTS_DIR, { recursive: true });
      write_json_atomic(path.join(G3_E1_INPUTS_DIR, id + '-input.json'), input_doc);
    }
  }

  const manifest = {
    schema_version: 1,
    track_count: manifest_entries.length,
    entries: manifest_entries,
  };
  manifest.manifest_hash = stable_json_hash(manifest.entries);

  return { manifest: manifest, inputs: manifest_entries };
}
