/**
 * G3-F.1 單次載入全庫 context（避免重複讀檔）
 */
import fs from 'node:fs';
import { FILE_LIBRARY_V2 } from '../../merge/v2/paths.js';
import { FILE_CLASSIFICATION_INDEX, FILE_FORMAL_CLASSIFICATION_STATE } from '../paths.js';
import { file_g3_evidence_index, file_g3_conflicts_report } from '../g3_evidence/paths.js';
import { load_g3_source_bundle } from '../g3_evidence/source_loaders.js';
import { build_ai_result_inventory, build_evidence_fingerprint } from '../g3_b/ai_result_catalog.js';
import { FILE_G3_D5_PROVENANCE } from '../g3_d/paths_d5.js';
import { select_g3_e1_pilot_5 } from '../g3_e/g3_e1_sample_5.js';
import { select_g3_e2_wave_20 } from '../g3_e/g3_e2_sample_20.js';
import { load_g3_f1_qualified_index } from './g3_f1_qualified.js';
import { has_valid_title } from '../g3_b/title_coverage_diagnostic.js';

function artists_identifiable(artists) {
  if (!artists || !artists.length) {
    return false;
  }
  for (let i = 0; i < artists.length; i += 1) {
    if (has_valid_title(artists[i])) {
      return true;
    }
  }
  return false;
}

/**
 * @returns {object}
 */
export function build_g3_f1_context() {
  const lib = JSON.parse(fs.readFileSync(FILE_LIBRARY_V2, 'utf8'));
  const index_doc = JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8'));
  const ev_doc = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8'));
  const formal = fs.existsSync(FILE_FORMAL_CLASSIFICATION_STATE)
    ? JSON.parse(fs.readFileSync(FILE_FORMAL_CLASSIFICATION_STATE, 'utf8'))
    : null;
  const conflicts_doc = fs.existsSync(file_g3_conflicts_report())
    ? JSON.parse(fs.readFileSync(file_g3_conflicts_report(), 'utf8'))
    : null;

  const bundle = load_g3_source_bundle();
  const fp = build_evidence_fingerprint(ev_doc.source_fingerprints);
  const qualified_index = load_g3_f1_qualified_index();

  const track_index = lib.track_index_by_spotify_id || {};
  const index_by = index_doc.tracks_by_id || {};
  const ev_tracks = ev_doc.tracks || {};
  const all_ids = Object.keys(index_by).sort();

  /** @type {Set<string>} */
  const d5_unverified = new Set();
  if (fs.existsSync(FILE_G3_D5_PROVENANCE)) {
    const prov = JSON.parse(fs.readFileSync(FILE_G3_D5_PROVENANCE, 'utf8'));
    for (let p = 0; p < prov.tracks.length; p += 1) {
      if (prov.tracks[p].provenance_status === 'provenance_unverified') {
        d5_unverified.add(prov.tracks[p].track_id);
      }
    }
  }

  /** @type {Set<string>} */
  const e_wave_done = new Set();
  const e1 = select_g3_e1_pilot_5().tracks;
  for (let a = 0; a < e1.length; a += 1) {
    e_wave_done.add(e1[a].track_id);
  }
  const e2 = select_g3_e2_wave_20().tracks;
  for (let b = 0; b < e2.length; b += 1) {
    e_wave_done.add(e2[b].track_id);
  }
  const e3_dir = qualified_index.ai_staged_set;
  e3_dir.forEach(function (id) {
    e_wave_done.add(id);
  });

  /** @type {Set<string>} */
  const conflict_ids = new Set();
  if (conflicts_doc && conflicts_doc.conflicts) {
    for (let c = 0; c < conflicts_doc.conflicts.length; c += 1) {
      conflict_ids.add(conflicts_doc.conflicts[c].track_id);
    }
  }

  /** @type {string[]} */
  const identifiable_ids = [];
  for (let j = 0; j < all_ids.length; j += 1) {
    const id = all_ids[j];
    const ev = ev_tracks[id];
    if (ev && has_valid_title(ev.identity && ev.identity.title) && artists_identifiable(ev.identity.artists)) {
      identifiable_ids.push(id);
    }
  }

  const inventory = build_ai_result_inventory(identifiable_ids, {
    bundle: bundle,
    evidence_fingerprint: fp,
  });
  /** @type {Map<string, object>} */
  const inv_by_id = new Map();
  for (let k = 0; k < inventory.per_track.length; k += 1) {
    inv_by_id.set(inventory.per_track[k].track_id, inventory.per_track[k]);
  }

  const formal_by = formal && formal.states_by_track_id ? formal.states_by_track_id : {};

  return {
    all_ids: all_ids,
    track_index: track_index,
    index_by: index_by,
    ev_tracks: ev_tracks,
    formal_by: formal_by,
    bundle: bundle,
    evidence_fingerprint: fp,
    qualified_set: qualified_index.qualified_set,
    ai_staged_set: qualified_index.ai_staged_set,
    d34_set: qualified_index.d34_set,
    catalog: qualified_index.catalog,
    d5_unverified: d5_unverified,
    e_wave_done: e_wave_done,
    conflict_ids: conflict_ids,
    identifiable_ids: identifiable_ids,
    inv_by_id: inv_by_id,
    helpers: { artists_identifiable: artists_identifiable, has_valid_title: has_valid_title },
  };
}
