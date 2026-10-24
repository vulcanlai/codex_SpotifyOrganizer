/**
 * G1 三十首試驗樣本（可重現、獨立於 phase-e / phase-f 檔案）
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { write_json_atomic } from '../../atomic_json.js';
import { FILE_AI_SAMPLE } from '../../classification/paths.js';
import {
  G1_TARGET_COUNT,
  G1_SAMPLE_ID,
  G1_SCHEMA_VERSION,
} from './paths.js';
import {
  file_g1_sample,
  file_g1_sample_trial,
  file_g1_selection_manifest_trial,
} from './g1_path_resolve.js';
import { load_index_tracks, build_external_track_input } from './track_input.js';

export const G1_MUST_INCLUDE_LEMON_TREE = '05B8gt3dCepBPmGe7SPAUo';
export const G1_SELECTION_SEED = 'g1-30:external-verify:v1';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function stable_hash(seed, id) {
  return crypto.createHash('sha256').update(seed + ':' + id).digest('hex');
}

function has_hangul(s) {
  return /[\uAC00-\uD7AF]/.test(s);
}

function has_kana(s) {
  return /[\u3040-\u309F\u30A0-\u30FF]/.test(s);
}

function has_cjk(s) {
  return /[\u4E00-\u9FFF]/.test(s);
}

function is_mostly_latin_title(s) {
  const t = String(s || '').trim();
  if (!t) {
    return false;
  }
  let latin = 0;
  let other = 0;
  for (let i = 0; i < t.length; i += 1) {
    const c = t.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 32 || c === 39) {
      latin += 1;
    } else if (c > 127) {
      other += 1;
    }
  }
  return latin > 0 && other === 0;
}

function title_bucket(row, input) {
  const title = input.title;
  const lower = title.toLowerCase();
  if (/live|remix|acoustic|現場|演唱會|版/.test(lower + title)) {
    return 'version_variant';
  }
  if (!input.isrc) {
    return 'missing_isrc';
  }
  if (row.metadata_status !== 'complete') {
    return 'incomplete_metadata';
  }
  if (has_hangul(title)) {
    return 'korean';
  }
  if (has_kana(title)) {
    return 'japanese';
  }
  if (has_cjk(title)) {
    return 'mandarin';
  }
  if (is_mostly_latin_title(title)) {
    const artists = input.artists.join(' ');
    if (has_cjk(artists)) {
      return 'latin_title_cjk_artist';
    }
    return 'english';
  }
  return 'other';
}

function load_v2_exclude() {
  const doc = read_json(FILE_AI_SAMPLE);
  if (!doc || !Array.isArray(doc.track_ids)) {
    return [];
  }
  return doc.track_ids.slice();
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function build_g1_sample(opts) {
  const options = opts || {};
  const tracks = load_index_tracks();
  const exclude_v2 = {};
  const v2_ids = load_v2_exclude();
  for (let i = 0; i < v2_ids.length; i += 1) {
    exclude_v2[v2_ids[i]] = true;
  }

  const buckets = {
    mandarin: [],
    english: [],
    japanese: [],
    korean: [],
    latin_title_cjk_artist: [],
    version_variant: [],
    missing_isrc: [],
    incomplete_metadata: [],
    other: [],
  };

  const title_index = {};
  const ids = Object.keys(tracks).sort();
  for (let j = 0; j < ids.length; j += 1) {
    const id = ids[j];
    const input = build_external_track_input(id);
    if (!input || !input.title) {
      continue;
    }
    const norm = input.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!title_index[norm]) {
      title_index[norm] = [];
    }
    title_index[norm].push(id);
    const bucket = title_bucket(tracks[id], input);
    buckets[bucket].push(id);
  }

  const same_title_ids = [];
  const norms = Object.keys(title_index);
  for (let k = 0; k < norms.length; k += 1) {
    if (title_index[norms[k]].length >= 2) {
      same_title_ids.push.apply(same_title_ids, title_index[norms[k]]);
    }
  }

  /** @type {string[]} */
  const selected = [];
  const used = {};

  function push_id(id, reason) {
    if (used[id] || selected.length >= G1_TARGET_COUNT) {
      return;
    }
    used[id] = true;
    selected.push(id);
    selection_reasons[id] = reason;
  }

  const selection_reasons = {};

  push_id(G1_MUST_INCLUDE_LEMON_TREE, 'language_trap_lemon_tree');

  const bucket_order = [
    ['mandarin', 4],
    ['english', 4],
    ['japanese', 3],
    ['korean', 2],
    ['latin_title_cjk_artist', 2],
    ['version_variant', 3],
    ['missing_isrc', 3],
    ['incomplete_metadata', 2],
  ];

  for (let b = 0; b < bucket_order.length; b += 1) {
    const key = bucket_order[b][0];
    const need = bucket_order[b][1];
    const pool = buckets[key].slice().sort(function (a, c) {
      const ha = stable_hash(G1_SELECTION_SEED, a);
      const hc = stable_hash(G1_SELECTION_SEED, c);
      return ha < hc ? -1 : 1;
    });
    let got = 0;
    for (let p = 0; p < pool.length && got < need; p += 1) {
      if (exclude_v2[pool[p]] && pool[p] !== G1_MUST_INCLUDE_LEMON_TREE) {
        continue;
      }
      if (!used[pool[p]]) {
        push_id(pool[p], 'bucket:' + key);
        got += 1;
      }
    }
  }

  if (same_title_ids.length) {
    const st = same_title_ids.slice().sort(function (a, c) {
      return stable_hash(G1_SELECTION_SEED, a) < stable_hash(G1_SELECTION_SEED, c)
        ? -1
        : 1;
    });
    for (let s = 0; s < st.length && selected.length < G1_TARGET_COUNT; s += 1) {
      push_id(st[s], 'same_title');
    }
  }

  const fill_pool = ids.filter(function (id) {
    return !used[id] && !exclude_v2[id];
  });
  fill_pool.sort(function (a, c) {
    return stable_hash(G1_SELECTION_SEED, a) < stable_hash(G1_SELECTION_SEED, c) ? -1 : 1;
  });
  for (let f = 0; f < fill_pool.length && selected.length < G1_TARGET_COUNT; f += 1) {
    push_id(fill_pool[f], 'fill');
  }

  const track_rows = [];
  for (let t = 0; t < selected.length; t += 1) {
    const sid = selected[t];
    const inp = build_external_track_input(sid);
    track_rows.push({
      spotify_id: sid,
      selection_reason: selection_reasons[sid] || 'fill',
      display: tracks[sid].display || {},
      metadata_status: tracks[sid].metadata_status,
      has_isrc: !!(inp && inp.isrc),
    });
  }

  const sample_doc = {
    schema_version: G1_SCHEMA_VERSION,
    sample_id: G1_SAMPLE_ID,
    purpose: 'g1_external_verification_trial',
    track_count: selected.length,
    track_ids: selected,
    must_include: [G1_MUST_INCLUDE_LEMON_TREE],
    selection_seed: G1_SELECTION_SEED,
    created_at: new Date().toISOString(),
    tracks: track_rows,
  };

  const manifest = {
    schema_version: G1_SCHEMA_VERSION,
    sample_id: G1_SAMPLE_ID,
    selection_seed: G1_SELECTION_SEED,
    bucket_targets: bucket_order,
    excluded_v2_sample_count: v2_ids.length,
    note: 'G1 樣本檔獨立於 phase-e-100 / phase-f-20；可與其曲目重疊（如 Lemon Tree）但不覆寫那些檔案。',
    track_ids: selected,
    selection_reasons: selection_reasons,
  };

  if (options.write) {
    write_json_atomic(file_g1_sample_trial(), sample_doc);
    write_json_atomic(file_g1_selection_manifest_trial(), manifest);
  }

  return {
    sample_doc: sample_doc,
    manifest: manifest,
  };
}

export function load_g1_sample() {
  const doc = read_json(file_g1_sample());
  if (!doc || !Array.isArray(doc.track_ids)) {
    return null;
  }
  return doc;
}

/** 正式 30 首試驗樣本（不受 SPOTIFYORG_G1_DATA_DIR 影響） */
export function load_g1_trial_sample() {
  const doc = read_json(file_g1_sample_trial());
  if (!doc || !Array.isArray(doc.track_ids)) {
    return null;
  }
  return doc;
}
