/**
 * G3-D.1 200 首分層抽樣（固定 seed）
 */
import crypto from 'node:crypto';
import { build_g3_d1_expansion_pool } from './g3_d1_pool.js';
import { G3_D1_SELECTION_SEED, G3_D1_WAVE_SIZE } from './paths_d1.js';

function stable_hash(seed, id) {
  return crypto.createHash('sha256').update(seed + ':' + id).digest('hex');
}

function pick_diverse(rows, already, n, seed) {
  const used = {};
  for (let i = 0; i < already.length; i += 1) {
    used[already[i]] = true;
  }
  const pool = rows.filter(function (r) {
    return !used[r.track_id] && !r.human_locked;
  });
  const picked = [];
  const picked_rows = [];
  let guard = 0;
  while (picked.length < n && pool.length && guard < 5000) {
    guard += 1;
    pool.sort(function (a, b) {
      let sa = 0;
      let sb = 0;
      const pd = {};
      const ps = {};
      const pl = {};
      const pv = {};
      for (let i = 0; i < picked_rows.length; i += 1) {
        pd[picked_rows[i].decade] = true;
        ps[picked_rows[i].title_script] = true;
        pl[picked_rows[i].index_language] = true;
        pv[picked_rows[i].vocal_hint] = true;
      }
      if (!pd[a.decade]) {
        sa += 4;
      }
      if (!pd[b.decade]) {
        sb += 4;
      }
      if (!ps[a.title_script]) {
        sa += 3;
      }
      if (!ps[b.title_script]) {
        sb += 3;
      }
      if (!pl[a.index_language]) {
        sa += 2;
      }
      if (!pl[b.index_language]) {
        sb += 2;
      }
      if (!pv[a.vocal_hint]) {
        sa += 2;
      }
      if (!pv[b.vocal_hint]) {
        sb += 2;
      }
      if (a.title_script === 'version_variant' || b.title_script === 'version_variant') {
        sa += a.title_script === 'version_variant' ? 1 : 0;
        sb += b.title_script === 'version_variant' ? 1 : 0;
      }
      if (a.multi_artist !== b.multi_artist) {
        sa += a.multi_artist ? 1 : 2;
        sb += b.multi_artist ? 1 : 2;
      }
      if (a.enrichment_complete !== b.enrichment_complete) {
        sa += a.enrichment_complete ? 0 : 2;
        sb += b.enrichment_complete ? 0 : 2;
      }
      if (sa !== sb) {
        return sb - sa;
      }
      return stable_hash(seed, a.track_id) < stable_hash(seed, b.track_id) ? -1 : 1;
    });
    const best = pool.shift();
    picked.push(best.track_id);
    picked_rows.push(best);
  }
  return { picked_ids: picked, picked_rows: picked_rows };
}

function summarize_distribution(rows) {
  const count_key = function (key) {
    const o = {};
    for (let i = 0; i < rows.length; i += 1) {
      const v = rows[i][key];
      o[v] = (o[v] || 0) + 1;
    }
    return o;
  };
  return {
    by_decade: count_key('decade'),
    by_index_language: count_key('index_language'),
    by_title_script: count_key('title_script'),
    by_vocal_hint: count_key('vocal_hint'),
    enrichment_complete: rows.filter(function (r) {
      return r.enrichment_complete;
    }).length,
    multi_artist: rows.filter(function (r) {
      return r.multi_artist;
    }).length,
  };
}

/**
 * @param {number} [count]
 */
export function select_g3_d1_wave_ids(count) {
  const target = count || G3_D1_WAVE_SIZE;
  const pool = build_g3_d1_expansion_pool();
  const rows = pool.pool_rows;
  const result = pick_diverse(rows, [], target, G3_D1_SELECTION_SEED);
  const dist = summarize_distribution(result.picked_rows);
  /** @type {string[]} */
  const shortfalls_zh = [];
  if (!dist.by_title_script.script_korean) {
    shortfalls_zh.push('200 首內無韓文歌名腳本命中；未虛構配額');
  }
  if ((dist.by_title_script.version_variant || 0) < 5) {
    shortfalls_zh.push(
      'Live/Remix/Cover 線索僅 ' + (dist.by_title_script.version_variant || 0) + ' 首；母體分布限制'
    );
  }
  if (dist.enrichment_complete < 30) {
    shortfalls_zh.push(
      'enrichment 完整僅 ' + dist.enrichment_complete + ' 首；metadata 不完整占比高'
    );
  }
  return {
    seed: G3_D1_SELECTION_SEED,
    pool_size: pool.needs_new_cursor_ai,
    selected_ids: result.picked_ids,
    selected_rows: result.picked_rows,
    distribution: dist,
    shortfalls_zh: shortfalls_zh,
    expansion_counts: {
      titled: pool.titled_track_count,
      g3_b: pool.g3_b_classified_count,
      reusable: pool.reusable_ai_outside_g3_b,
      needs_new: pool.needs_new_cursor_ai,
    },
  };
}
