/**
 * G3-E.3 D.5 unverified 與 E.1/E.2 對帳
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { FILE_G3_D5_PROVENANCE } from '../g3_d/paths_d5.js';
import { select_g3_e1_pilot_5 } from './g3_e1_sample_5.js';
import { select_g3_e2_wave_20 } from './g3_e2_sample_20.js';
import { G3_E3_WAVE_SEED, G3_E3_BATCH_SIZE } from './paths_e3.js';

function rank(seed, id) {
  return crypto.createHash('sha256').update(seed + ':' + id).digest('hex');
}

/**
 * @returns {object}
 */
export function build_g3_e3_reconciliation() {
  const prov = JSON.parse(fs.readFileSync(FILE_G3_D5_PROVENANCE, 'utf8'));
  /** @type {string[]} */
  const d5_unverified = [];
  for (let i = 0; i < prov.tracks.length; i += 1) {
    const t = prov.tracks[i];
    if (t.provenance_status === 'provenance_unverified') {
      d5_unverified.push(t.track_id);
    }
  }

  const e1_ids = select_g3_e1_pilot_5().tracks.map(function (t) {
    return t.track_id;
  });
  const e2_ids = select_g3_e2_wave_20().tracks.map(function (t) {
    return t.track_id;
  });

  const e1_in_unverified = e1_ids.filter(function (id) {
    return d5_unverified.indexOf(id) >= 0;
  });
  const e1_not_in_unverified = e1_ids.filter(function (id) {
    return d5_unverified.indexOf(id) < 0;
  });

  const e2_set = {};
  for (let e = 0; e < e2_ids.length; e += 1) {
    e2_set[e2_ids[e]] = true;
  }
  const e1_unv_set = {};
  for (let u = 0; u < e1_in_unverified.length; u += 1) {
    e1_unv_set[e1_in_unverified[u]] = true;
  }

  const overlap_e1_e2 = e2_ids.filter(function (id) {
    return e1_ids.indexOf(id) >= 0;
  });

  /** @type {string[]} */
  const remainder = d5_unverified
    .filter(function (id) {
      return !e2_set[id] && !e1_unv_set[id];
    })
    .sort(function (a, b) {
      return rank(G3_E3_WAVE_SEED, a) < rank(G3_E3_WAVE_SEED, b) ? -1 : 1;
    });

  const dup_check = new Set(d5_unverified);
  const missing_in_prov = d5_unverified.length !== dup_check.size;

  return {
    schema_version: 1,
    d5_provenance_unverified_count: d5_unverified.length,
    d5_unverified_ids: d5_unverified,
    e1_pilot_count: e1_ids.length,
    e1_in_d5_unverified: e1_in_unverified,
    e1_not_in_d5_unverified: e1_not_in_unverified,
    e2_wave_count: e2_ids.length,
    e2_ids: e2_ids,
    overlap_e1_e2_on_pilot: overlap_e1_e2,
    already_handled_in_unverified_pool: e1_in_unverified.length + e2_ids.length,
    remainder_count: remainder.length,
    remainder_ids: remainder,
    integrity: {
      duplicate_ids_in_d5_list: missing_in_prov,
      e2_subset_of_remainder_plus_e1: e2_ids.every(function (id) {
        return d5_unverified.indexOf(id) >= 0;
      }),
      accounting_check:
        e1_in_unverified.length + e2_ids.length + remainder.length === d5_unverified.length,
    },
  };
}

/**
 * @param {object} recon
 */
export function build_g3_e3_wave_from_remainder(recon) {
  const ids = recon.remainder_ids;
  /** @type {object[]} */
  const tracks = [];
  for (let i = 0; i < ids.length; i += 1) {
    tracks.push({
      track_id: ids[i],
      cohort: 'd5_provenance_unverified_remainder',
      selection_reason_zh: 'D.5 provenance_unverified 剩餘列（排除 E.1∩unv 與 E.2 wave-20）',
    });
  }

  const batch_count = Math.ceil(ids.length / G3_E3_BATCH_SIZE);
  /** @type {object[]} */
  const batches = [];
  for (let b = 0; b < batch_count; b += 1) {
    const slice = tracks.slice(b * G3_E3_BATCH_SIZE, (b + 1) * G3_E3_BATCH_SIZE);
    batches.push({
      batch_index: b + 1,
      batch_id: 'g3e3-batch-' + String(b + 1).padStart(2, '0'),
      track_ids: slice.map(function (x) {
        return x.track_id;
      }),
      tracks: slice,
    });
  }

  return {
    seed: G3_E3_WAVE_SEED,
    wave_id: 'g3-e3-unverified-remainder',
    source_pool: 'd5_provenance_unverified_remainder',
    reconciliation_ref: 'reconciliation-e1-e2-e3.json',
    track_count: tracks.length,
    batch_size: G3_E3_BATCH_SIZE,
    batch_count: batch_count,
    infer_input_policy: {
      include_review_only_suggestions: false,
      note_zh: '推理輸入僅 metadata＋sourced evidence facts；舊 AI 僅在 compare 階段使用',
    },
    tracks: tracks,
    batches: batches,
  };
}

export function select_g3_e3_wave() {
  const recon = build_g3_e3_reconciliation();
  return build_g3_e3_wave_from_remainder(recon);
}
