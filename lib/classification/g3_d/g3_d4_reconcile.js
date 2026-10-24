/**
 * G3-D.4 對帳 D.1 200 / D.3 30 / 待處理 170
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { FILE_G3_D1_SAMPLE_200 } from './paths_d1.js';
import { FILE_G3_D3_SAMPLE_30 } from './paths_d3.js';
import {
  G3_D4_PENDING_SEED,
  G3_D4_BATCH_SIZE,
  G3_D4_BATCH_COUNT,
} from './paths_d4.js';

function rank(seed, id) {
  return crypto.createHash('sha256').update(seed + ':' + id).digest('hex');
}

function sort_ids(ids, seed) {
  return ids.slice().sort(function (a, b) {
    return rank(seed, a) < rank(seed, b) ? -1 : 1;
  });
}

/**
 * @returns {object}
 */
export function reconcile_d1_d3_d4() {
  const d1 = JSON.parse(fs.readFileSync(FILE_G3_D1_SAMPLE_200, 'utf8'));
  const d3_sample = JSON.parse(fs.readFileSync(FILE_G3_D3_SAMPLE_30, 'utf8'));

  const d1_ids = (d1.track_ids || []).slice();
  const d3_ids = d3_sample.tracks.map(function (t) {
    return t.track_id;
  });

  const d1_set = {};
  const dup_d1 = [];
  for (let i = 0; i < d1_ids.length; i += 1) {
    if (d1_set[d1_ids[i]]) {
      dup_d1.push(d1_ids[i]);
    }
    d1_set[d1_ids[i]] = true;
  }

  const d3_set = {};
  const dup_d3 = [];
  for (let j = 0; j < d3_ids.length; j += 1) {
    if (d3_set[d3_ids[j]]) {
      dup_d3.push(d3_ids[j]);
    }
    d3_set[d3_ids[j]] = true;
  }

  const missing_in_d1 = [];
  for (let k = 0; k < d3_ids.length; k += 1) {
    if (!d1_set[d3_ids[k]]) {
      missing_in_d1.push(d3_ids[k]);
    }
  }

  const pending = d1_ids.filter(function (id) {
    return !d3_set[id];
  });
  const pending_sorted = sort_ids(pending, G3_D4_PENDING_SEED);

  /** @type {object[]} */
  const batches = [];
  for (let b = 0; b < G3_D4_BATCH_COUNT; b += 1) {
    const start = b * G3_D4_BATCH_SIZE;
    const slice = pending_sorted.slice(start, start + G3_D4_BATCH_SIZE);
    batches.push({
      batch_index: b + 1,
      batch_id: 'g3d4-batch-' + String(b + 1).padStart(2, '0'),
      track_ids: slice,
      count: slice.length,
    });
  }

  const batch_track_total = batches.reduce(function (acc, row) {
    return acc + row.count;
  }, 0);

  const ok =
    d1_ids.length === 200 &&
    d3_ids.length === 30 &&
    pending.length === 170 &&
    batch_track_total === 170 &&
    dup_d1.length === 0 &&
    dup_d3.length === 0 &&
    missing_in_d1.length === 0;

  return {
    ok: ok,
    d1_total: d1_ids.length,
    d3_total: d3_ids.length,
    pending_total: pending.length,
    d1_track_ids: d1_ids,
    d3_track_ids: d3_ids,
    d3_preserved_note_zh: 'D.3 30 首不重跑；候選見 g3-d3-repair-30/cursor-agent-drafts-30.json',
    pending_track_ids: pending_sorted,
    pending_seed: G3_D4_PENDING_SEED,
    batches: batches,
    errors: {
      dup_d1: dup_d1,
      dup_d3: dup_d3,
      missing_d3_in_d1: missing_in_d1,
      batch_track_total: batch_track_total,
    },
  };
}
