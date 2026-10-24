/**
 * G3-E.3 比較與 E.1/E.2/E.3 對帳
 */
import fs from 'node:fs';
import path from 'node:path';
import { compare_d1_d34_e2_20 } from './g3_e2_compare.js';
import { build_g3_e3_reconciliation } from './g3_e3_reconcile.js';
import { select_g3_e1_pilot_5 } from './g3_e1_sample_5.js';
import { select_g3_e2_wave_20 } from './g3_e2_sample_20.js';
import { G3_E1_STAGED_DIR } from './paths_e1.js';
import { G3_E2_STAGED_DIR } from './paths_e2.js';
import { G3_E3_STAGED_DIR } from './paths_e3.js';

/**
 * @param {object[]} e3_rows
 * @param {string[]} track_ids
 */
export function compare_d1_d34_e3(e3_rows, track_ids) {
  return compare_d1_d34_e2_20(e3_rows, track_ids);
}

function staged_ids(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter(function (f) {
      return f.endsWith('-staged.json');
    })
    .map(function (f) {
      return f.replace('-staged.json', '');
    });
}

/**
 * @param {string[]} e3_staged_ids
 */
export function build_g3_e1_e2_e3_ledger(e3_staged_ids) {
  const recon = build_g3_e3_reconciliation();
  const e1 = select_g3_e1_pilot_5().tracks.map(function (t) {
    return t.track_id;
  });
  const e2 = select_g3_e2_wave_20().tracks.map(function (t) {
    return t.track_id;
  });
  const e1_staged = staged_ids(G3_E1_STAGED_DIR);
  const e2_staged = staged_ids(G3_E2_STAGED_DIR);

  const e3_set = {};
  for (let i = 0; i < e3_staged_ids.length; i += 1) {
    e3_set[e3_staged_ids[i]] = true;
  }

  /** @type {string[]} */
  const pending = recon.remainder_ids.filter(function (id) {
    return !e3_set[id];
  });

  return {
    schema_version: 1,
    d5_unverified_total: recon.d5_provenance_unverified_count,
    e1_pilot_all: e1,
    e1_staged_on_disk: e1_staged,
    e1_in_d5_unverified: recon.e1_in_d5_unverified,
    e2_wave_ids: e2,
    e2_staged_on_disk: e2_staged,
    e3_staged_count: e3_staged_ids.length,
    e3_staged_ids: e3_staged_ids,
    cumulative_on_d5_unverified_pool:
      recon.e1_in_d5_unverified.length + e2.length + e3_staged_ids.length,
    remainder_total: recon.remainder_count,
    pending_e3_ids: pending,
    pending_e3_count: pending.length,
  };
}
