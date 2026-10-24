/**
 * G3-F.1 固定 seed 抽樣（最多 100 首）
 */
import crypto from 'node:crypto';
import { G3_F1_WAVE_SEED, G3_F1_WAVE_SIZE, G3_F1_BATCH_SIZE } from './paths_f1.js';

/**
 * @typedef {{
 *   seed: string,
 *   wave_id: string,
 *   wave_size: number,
 *   batch_size: number,
 *   batch_id_prefix: string,
 *   cohort: string,
 * }} G3FWaveSelectConfig
 */

const GENRE_BUCKETS = [
  'pop',
  'rock',
  'folk',
  'electronic',
  'hip_hop',
  'soundtrack_instrumental',
  'unknown',
  'other',
];

function stable_hash(seed, id) {
  return crypto.createHash('sha256').update(seed + ':' + id).digest('hex');
}

function genre_bucket(rule_primary) {
  const p = rule_primary || 'unknown';
  return GENRE_BUCKETS.indexOf(p) >= 0 ? p : 'other';
}

function pick_diverse(pool_rows, target, seed) {
  /** @type {object[]} */
  const picked_rows = [];
  const used = {};
  const bucket_fill = {};
  for (let g = 0; g < GENRE_BUCKETS.length; g += 1) {
    bucket_fill[GENRE_BUCKETS[g]] = 0;
  }
  const pool = pool_rows.slice();
  let guard = 0;
  while (picked_rows.length < target && pool.length && guard < 5000) {
    guard += 1;
    pool.sort(function (a, b) {
      let sa = 0;
      let sb = 0;
      const ba = genre_bucket(a.diversity_rule_primary_hint);
      const bb = genre_bucket(b.diversity_rule_primary_hint);
      if (bucket_fill[ba] < 2) {
        sa += 6;
      }
      if (bucket_fill[bb] < 2) {
        sb += 6;
      }
      const scripts = {};
      const langs = {};
      for (let i = 0; i < picked_rows.length; i += 1) {
        scripts[picked_rows[i].title_script] = true;
        langs[picked_rows[i].index_language] = true;
      }
      if (!scripts[a.title_script]) {
        sa += 3;
      }
      if (!scripts[b.title_script]) {
        sb += 3;
      }
      if (!langs[a.index_language]) {
        sa += 2;
      }
      if (!langs[b.index_language]) {
        sb += 2;
      }
      if (sa !== sb) {
        return sb - sa;
      }
      return stable_hash(seed, a.track_id) < stable_hash(seed, b.track_id) ? -1 : 1;
    });
    const best = pool.shift();
    if (!best || used[best.track_id]) {
      continue;
    }
    used[best.track_id] = true;
    picked_rows.push(best);
    const gb = genre_bucket(best.diversity_rule_primary_hint);
    bucket_fill[gb] = (bucket_fill[gb] || 0) + 1;
  }
  picked_rows.sort(function (a, b) {
    return stable_hash(seed, a.track_id) < stable_hash(seed, b.track_id) ? -1 : 1;
  });
  return { picked_rows: picked_rows, bucket_fill: bucket_fill };
}

/**
 * @param {object} queue_doc
 * @param {G3FWaveSelectConfig} config
 * @param {{ wave_size?: number }} [opts]
 */
export function select_g3_f_wave(queue_doc, config, opts) {
  const options = opts || {};
  const target = Math.min(options.wave_size || config.wave_size, queue_doc.pending_count);
  const picked = pick_diverse(queue_doc.pending_tracks, target, config.seed);

  /** @type {object[]} */
  const tracks = [];
  for (let i = 0; i < picked.picked_rows.length; i += 1) {
    const r = picked.picked_rows[i];
    tracks.push({
      track_id: r.track_id,
      cohort: config.cohort,
      selection_reason_zh: r.queue_reason_zh,
      diversity_rule_primary_hint: r.diversity_rule_primary_hint,
      title_script: r.title_script,
      index_language: r.index_language,
      exclusion_note_zh: '固定 seed 抽樣；rule primary 僅供多樣性非正解',
    });
  }

  const batch_count = Math.ceil(tracks.length / config.batch_size);
  /** @type {object[]} */
  const batches = [];
  for (let b = 0; b < batch_count; b += 1) {
    const slice = tracks.slice(b * config.batch_size, (b + 1) * config.batch_size);
    batches.push({
      batch_index: b + 1,
      batch_id: config.batch_id_prefix + String(b + 1).padStart(2, '0'),
      track_ids: slice.map(function (x) {
        return x.track_id;
      }),
      tracks: slice,
    });
  }

  return {
    seed: config.seed,
    wave_id: config.wave_id,
    queue_pending_at_selection: queue_doc.pending_count,
    track_count: tracks.length,
    batch_size: config.batch_size,
    batch_count: batch_count,
    diversity_bucket_filled: picked.bucket_fill,
    infer_input_policy: {
      include_review_only_suggestions: false,
      note_zh: '推理輸入僅 metadata＋sourced evidence；不含舊 AI 建議',
    },
    tracks: tracks,
    batches: batches,
  };
}

/** @param {object} queue_doc @param {{ wave_size?: number }} [opts] */
export function select_g3_f1_wave(queue_doc, opts) {
  return select_g3_f_wave(
    queue_doc,
    {
      seed: G3_F1_WAVE_SEED,
      wave_id: 'g3-f1-wave-100',
      wave_size: G3_F1_WAVE_SIZE,
      batch_size: G3_F1_BATCH_SIZE,
      batch_id_prefix: 'g3f1-batch-',
      cohort: 'g3_f1_pending_queue',
    },
    opts
  );
}
