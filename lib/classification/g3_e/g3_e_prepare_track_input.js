/**
 * 共用：單首 Agent 輸入包（E.1/E.2）
 */
import { main_to_allowed_subgenres_map } from '../g3_d/g3_d3_agent_repair_drafts.js';
import { stable_json_hash } from './g3_e1_hash.js';

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
 * @param {string} track_id
 * @param {object} ev
 * @param {object} meta cohort info
 */
export function build_agent_input_doc(track_id, ev, meta) {
  const identity = ev && ev.identity ? ev.identity : {};
  const input_doc = {
    schema_version: 1,
    track_id: track_id,
    purpose: 'g3_e_agent_infer_input',
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
    main_to_allowed_subgenres: main_to_allowed_subgenres_map(),
    cohort: meta.cohort || null,
    selection_reason_zh: meta.selection_reason_zh || null,
    review_only_suggestions: meta.review_only_suggestions || null,
  };
  input_doc.input_hash = stable_json_hash(input_doc);
  return input_doc;
}
