/**
 * G3-E.2 自 140 provenance_unverified 選 20 首
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { FILE_G3_D5_PROVENANCE } from '../g3_d/paths_d5.js';
import { FILE_G3_D4_MERGED_CANDIDATE_200 } from '../g3_d/paths_d4.js';
import { G3_D1_BATCH_DRAFTS_DIR } from '../g3_d/paths_d1.js';
import path from 'node:path';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import {
  G3_E2_WAVE_SEED,
  G3_E2_EXCLUDE_E1_IDS,
  G3_E2_BATCH_SIZE,
  G3_E2_BATCH_COUNT,
} from './paths_e2.js';

function rank(seed, id) {
  return crypto.createHash('sha256').update(seed + ':' + id).digest('hex');
}

function pick(pool, seed, n, used) {
  return pool
    .filter(function (id) {
      return !used[id];
    })
    .sort(function (a, b) {
      return rank(seed, a) < rank(seed, b) ? -1 : 1;
    })
    .slice(0, n);
}

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

export function select_g3_e2_wave_20() {
  const prov = JSON.parse(fs.readFileSync(FILE_G3_D5_PROVENANCE, 'utf8'));
  const merged = JSON.parse(fs.readFileSync(FILE_G3_D4_MERGED_CANDIDATE_200, 'utf8'));
  const d1_by = load_d1_by_id();
  const ev_all = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};
  const d34_by = {};
  for (let m = 0; m < merged.tracks.length; m += 1) {
    d34_by[merged.tracks[m].track_id] = merged.tracks[m];
  }

  const exclude = {};
  for (let e = 0; e < G3_E2_EXCLUDE_E1_IDS.length; e += 1) {
    exclude[G3_E2_EXCLUDE_E1_IDS[e]] = true;
  }

  const unverified = [];
  for (let i = 0; i < prov.tracks.length; i += 1) {
    const t = prov.tracks[i];
    if (t.provenance_status !== 'provenance_unverified') {
      continue;
    }
    if (exclude[t.track_id]) {
      continue;
    }
    unverified.push(t.track_id);
  }

  const soundtrack = [];
  const unknown_d1 = [];
  const sparse = [];
  const rich = [];
  const low_tier = [];
  const medium_high = [];

  for (let u = 0; u < unverified.length; u += 1) {
    const id = unverified[u];
    const d1 = d1_by[id];
    const d34 = d34_by[id];
    const ev = ev_all[id];
    const ident = ev && ev.identity ? ev.identity : {};
    if (d34 && d34.genre_profile.primary_genre === 'soundtrack_instrumental') {
      soundtrack.push(id);
    }
    if (d1 && d1.genre_profile.primary_genre === 'unknown') {
      unknown_d1.push(id);
    }
    if (!ident.enrichment_cache_complete && !ident.album_name) {
      sparse.push(id);
    } else {
      rich.push(id);
    }
    if (d34 && d34.confidence_tier === 'low') {
      low_tier.push(id);
    } else if (d34) {
      medium_high.push(id);
    }
  }

  const used = {};
  /** @type {object[]} */
  const picked_meta = [];
  const shortfalls = [];

  function take(pool, n, cohort, reason_zh) {
    const chosen = pick(pool, G3_E2_WAVE_SEED + ':' + cohort, n, used);
    if (chosen.length < n) {
      shortfalls.push(cohort + ' 需求 ' + n + ' 實得 ' + chosen.length);
    }
    for (let c = 0; c < chosen.length; c += 1) {
      used[chosen[c]] = true;
      picked_meta.push({
        track_id: chosen[c],
        cohort: cohort,
        selection_reason_zh: reason_zh,
      });
    }
  }

  take(soundtrack, 6, 'soundtrack_unverified', 'D.34 配樂＋provenance_unverified');
  take(unknown_d1, 5, 'd1_unknown', 'D.1 unknown fallback');
  take(sparse, 4, 'metadata_sparse', 'metadata 稀疏');
  take(rich, 3, 'metadata_richer', 'album/ enrichment 較完整');
  take(low_tier, 2, 'low_confidence_d34', 'D.34 confidence low');

  if (picked_meta.length < 20) {
    take(unverified, 20 - picked_meta.length, 'fill_balance', 'seed 補齊至 20');
  }
  if (picked_meta.length > 20) {
    picked_meta.length = 20;
  }

  /** @type {object[]} */
  const batches = [];
  for (let b = 0; b < G3_E2_BATCH_COUNT; b += 1) {
    const slice = picked_meta.slice(b * G3_E2_BATCH_SIZE, (b + 1) * G3_E2_BATCH_SIZE);
    batches.push({
      batch_index: b + 1,
      batch_id: 'g3e2-batch-' + String(b + 1).padStart(2, '0'),
      track_ids: slice.map(function (x) {
        return x.track_id;
      }),
      tracks: slice,
    });
  }

  return {
    seed: G3_E2_WAVE_SEED,
    source_pool: 'd5_provenance_unverified_140',
    excluded_e1_ids: G3_E2_EXCLUDE_E1_IDS,
    pool_size_unverified: unverified.length,
    track_count: picked_meta.length,
    shortfalls_zh: shortfalls,
    tracks: picked_meta,
    batches: batches,
  };
}
