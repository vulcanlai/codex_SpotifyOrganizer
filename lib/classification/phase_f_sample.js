/**
 * phase-f-20 可重現分層抽樣（來源：phase-e-100 已匯入候選）
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { write_json_atomic } from '../atomic_json.js';
import { FILE_CLASSIFICATION_INDEX } from './paths.js';
import {
  FILE_PHASE_E_CANDIDATES_IMPORTED,
  FILE_PHASE_E_SAMPLE,
  TEST_BATCH_PHASE_E_100,
} from './ai_test_batches.js';
import { compute_confidence_tier } from './confidence_tier.js';
import { genre_profile_from_ai_candidate } from './genre_profile.js';
import {
  decade_from_tags,
  primary_artist_name,
} from './ai_sample_select.js';
import {
  FILE_PHASE_F_SAMPLE,
  FILE_PHASE_F_SELECTION_MANIFEST,
  FILE_PHASE_F_BUILD_SNAPSHOT,
  PHASE_F_DIR,
  PHASE_F_AUDIT_ID,
  PHASE_F_SCHEMA_VERSION,
  PHASE_F_TARGET_COUNT,
} from './quality_audit_paths.js';
import {
  FILE_MANUAL_OVERRIDES,
  FILE_AI_CANDIDATES_V2,
  FILE_AI_REVIEW_V2,
} from './paths.js';

export const PHASE_F_SAMPLE_ID = 'c7e4a91f2b0d3e8f';
export const PHASE_F_SELECTION_SEED = 'phase-f-20:stratified:v1';

export const PHASE_F_STRATUM_TARGETS = {
  high: 8,
  medium: 5,
  low: 3,
  unknown_primary: 4,
};

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function stable_hash(seed, id) {
  return crypto.createHash('sha256').update(seed + ':' + id).digest('hex');
}

function sort_ids_deterministic(ids, seed) {
  return ids.slice().sort(function (a, b) {
    const ha = stable_hash(seed, a);
    const hb = stable_hash(seed, b);
    if (ha < hb) {
      return -1;
    }
    if (ha > hb) {
      return 1;
    }
    return a < b ? -1 : 1;
  });
}

/**
 * @param {object[]} rows
 * @param {string[]} already
 * @param {number} n
 * @param {string} seed
 * @param {function} score_fn
 */
function pick_diverse(rows, already, n, seed, score_fn) {
  const used = {};
  for (let i = 0; i < already.length; i += 1) {
    used[already[i]] = true;
  }
  const pool = rows.filter(function (r) {
    return !used[r.spotify_id];
  });
  const picked = [];
  let guard = 0;
  while (picked.length < n && pool.length && guard < 500) {
    guard += 1;
    pool.sort(function (a, b) {
      const sa = score_fn(a, picked, seed);
      const sb = score_fn(b, picked, seed);
      if (sa !== sb) {
        return sb - sa;
      }
      const ha = stable_hash(seed, a.spotify_id);
      const hb = stable_hash(seed, b.spotify_id);
      return ha < hb ? -1 : 1;
    });
    const best = pool.shift();
    picked.push(best.spotify_id);
    used[best.spotify_id] = true;
  }
  return picked;
}

function diversity_score(row, picked_ids, picked_rows, seed) {
  let score = 0;
  const decades = {};
  const artists = {};
  const langs = {};
  let pop_n = 0;
  let non_pop_n = 0;
  for (let i = 0; i < picked_rows.length; i += 1) {
    const pr = picked_rows[i];
    decades[pr.decade] = true;
    artists[pr.artist] = true;
    langs[pr.language] = true;
    if (pr.is_pop) {
      pop_n += 1;
    } else {
      non_pop_n += 1;
    }
  }
  if (!decades[row.decade]) {
    score += 4;
  }
  if (!artists[row.artist]) {
    score += 3;
  }
  if (!langs[row.language]) {
    score += 2;
  }
  if (row.is_pop && non_pop_n <= pop_n) {
    score += 2;
  }
  if (!row.is_pop && pop_n <= non_pop_n) {
    score += 2;
  }
  score += (parseInt(stable_hash(seed, row.spotify_id).slice(0, 4), 16) % 7) * 0.01;
  return score;
}

/**
 * @param {object} [opts]
 */
export function build_phase_f_rows(opts) {
  const options = opts || {};
  const imported =
    options.candidates_doc || read_json(FILE_PHASE_E_CANDIDATES_IMPORTED);
  const sample_doc = options.sample_doc || read_json(FILE_PHASE_E_SAMPLE);
  const index =
    options.index_doc ||
    read_json(FILE_CLASSIFICATION_INDEX);
  if (!imported || !imported.candidates || !imported.candidates.length) {
    throw new Error('缺少 phase-e-100 已匯入候選');
  }
  if (!sample_doc || !sample_doc.track_ids) {
    throw new Error('缺少 phase-e sample-100.json');
  }
  const sample_set = {};
  for (let i = 0; i < sample_doc.track_ids.length; i += 1) {
    sample_set[sample_doc.track_ids[i]] = true;
  }
  const tracks_by_id = (index && index.tracks_by_id) || {};
  const rows = [];
  for (let c = 0; c < imported.candidates.length; c += 1) {
    const cand = imported.candidates[c];
    const id = cand.spotify_id;
    if (!sample_set[id]) {
      throw new Error('候選不在 phase-e 樣本內：' + id);
    }
    const row = tracks_by_id[id] || null;
    const gp = genre_profile_from_ai_candidate(cand);
    const tier = compute_confidence_tier({
      candidate: cand,
      index_row: row,
    });
    rows.push({
      spotify_id: id,
      tier: tier.tier,
      unknown_primary: gp.primary_genre === 'unknown',
      is_pop: gp.primary_genre === 'pop',
      decade: decade_from_tags(row),
      artist: primary_artist_name(row),
      language: cand.language && cand.language.value ? cand.language.value : '未確認',
    });
  }
  return {
    rows,
    sample_doc,
    imported,
    content_fingerprint: imported.content_fingerprint || null,
  };
}

/**
 * @param {object} [opts]
 */
export function select_phase_f_track_ids(opts) {
  const built = build_phase_f_rows(opts);
  const rows = built.rows;
  const seed = PHASE_F_SELECTION_SEED;
  const selected = [];
  const selected_rows = [];

  const unknown_ids = sort_ids_deterministic(
    rows.filter(function (r) {
      return r.unknown_primary;
    }).map(function (r) {
      return r.spotify_id;
    }),
    seed + ':unknown'
  );
  for (let u = 0; u < unknown_ids.length; u += 1) {
    selected.push(unknown_ids[u]);
    for (let r = 0; r < rows.length; r += 1) {
      if (rows[r].spotify_id === unknown_ids[u]) {
        selected_rows.push(rows[r]);
        break;
      }
    }
  }

  function pick_from_tier(tier_name, target_n, seed_suffix) {
    const tier_rows = rows.filter(function (r) {
      return r.tier === tier_name && selected.indexOf(r.spotify_id) < 0;
    });
    const ids = pick_diverse(
      tier_rows,
      selected,
      target_n,
      seed + seed_suffix,
      function (row, picked, s) {
        const pr = [];
        for (let i = 0; i < picked.length; i += 1) {
          for (let j = 0; j < rows.length; j += 1) {
            if (rows[j].spotify_id === picked[i]) {
              pr.push(rows[j]);
              break;
            }
          }
        }
        return diversity_score(row, picked, pr, s);
      }
    );
    for (let i = 0; i < ids.length; i += 1) {
      selected.push(ids[i]);
      for (let r = 0; r < rows.length; r += 1) {
        if (rows[r].spotify_id === ids[i]) {
          selected_rows.push(rows[r]);
          break;
        }
      }
    }
    return ids;
  }

  pick_from_tier('high', PHASE_F_STRATUM_TARGETS.high, ':high');
  pick_from_tier('medium', PHASE_F_STRATUM_TARGETS.medium, ':medium');

  const low_non_unknown = rows.filter(function (r) {
    return r.tier === 'low' && !r.unknown_primary && selected.indexOf(r.spotify_id) < 0;
  });
  if (low_non_unknown.length) {
    pick_from_tier('low', PHASE_F_STRATUM_TARGETS.low, ':low');
  }

  while (selected.length < PHASE_F_TARGET_COUNT) {
    const remain = rows.filter(function (r) {
      return selected.indexOf(r.spotify_id) < 0;
    });
    if (!remain.length) {
      break;
    }
    const extra = pick_diverse(
      remain,
      selected,
      1,
      seed + ':fill:' + selected.length,
      function (row, picked, s) {
        const pr = [];
        for (let i = 0; i < picked.length; i += 1) {
          for (let j = 0; j < rows.length; j += 1) {
            if (rows[j].spotify_id === picked[i]) {
              pr.push(rows[j]);
              break;
            }
          }
        }
        return diversity_score(row, picked, pr, s);
      }
    );
    if (!extra.length) {
      break;
    }
    selected.push(extra[0]);
    for (let r = 0; r < rows.length; r += 1) {
      if (rows[r].spotify_id === extra[0]) {
        selected_rows.push(rows[r]);
        break;
      }
    }
  }

  if (selected.length !== PHASE_F_TARGET_COUNT) {
    throw new Error(
      '無法湊滿 ' +
        PHASE_F_TARGET_COUNT +
        ' 首，實際 ' +
        selected.length
    );
  }

  const tier_counts = { high: 0, medium: 0, low: 0 };
  let unknown_n = 0;
  let pop_n = 0;
  const decades = {};
  const artists = {};
  const langs = {};
  for (let i = 0; i < selected_rows.length; i += 1) {
    const sr = selected_rows[i];
    tier_counts[sr.tier] = (tier_counts[sr.tier] || 0) + 1;
    if (sr.unknown_primary) {
      unknown_n += 1;
    }
    if (sr.is_pop) {
      pop_n += 1;
    }
    decades[sr.decade] = (decades[sr.decade] || 0) + 1;
    artists[sr.artist] = (artists[sr.artist] || 0) + 1;
    langs[sr.language] = (langs[sr.language] || 0) + 1;
  }

  const notes = [];
  if (low_non_unknown.length === 0) {
    notes.push(
      '母體僅 4 首 low 且皆為 unknown 主曲風；low 配額 3 與 unknown 4 重疊，樣本含全部 4 首 unknown 代表 low 層。'
    );
  }
  if (selected.length > unknown_ids.length + PHASE_F_STRATUM_TARGETS.high + PHASE_F_STRATUM_TARGETS.medium) {
    notes.push(
      '剩餘名額以年代／藝人／語言／pop 平衡填補至 20 首；因 low 全為 unknown 已用盡，填補列多為 high 層，實際 high 數可能高於目標 8。'
    );
  }

  return {
    track_ids: selected,
    sample_id: PHASE_F_SAMPLE_ID,
    selection_seed: seed,
    stratum_targets: PHASE_F_STRATUM_TARGETS,
    actual_distribution: {
      confidence_tier: tier_counts,
      unknown_primary: unknown_n,
      pop: pop_n,
      non_pop: selected.length - pop_n,
      decades,
      unique_artists: Object.keys(artists).length,
      languages: langs,
    },
    selection_notes: notes,
    source_test_batch_id: TEST_BATCH_PHASE_E_100,
    source_sample_id: built.sample_doc.sample_id,
    source_candidates_fingerprint: built.content_fingerprint,
    selected_rows,
  };
}

function file_sha256(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/**
 * @param {object} [opts]
 */
export function build_phase_f_sample(opts) {
  const options = opts || {};
  const selection = select_phase_f_track_ids(options);
  const built_at = new Date().toISOString();

  const sample_doc = {
    schema_version: PHASE_F_SCHEMA_VERSION,
    audit_id: PHASE_F_AUDIT_ID,
    sample_id: selection.sample_id,
    built_at,
    track_count: PHASE_F_TARGET_COUNT,
    track_ids: selection.track_ids,
    source_test_batch_id: selection.source_test_batch_id,
    source_sample_id: selection.source_sample_id,
    source_candidates_fingerprint: selection.source_candidates_fingerprint,
    selection_seed: selection.selection_seed,
    stratum_targets: selection.stratum_targets,
    actual_distribution: selection.actual_distribution,
    selection_notes: selection.selection_notes,
  };

  const manifest = {
    schema_version: PHASE_F_SCHEMA_VERSION,
    audit_id: PHASE_F_AUDIT_ID,
    built_at,
    algorithm: 'stratified_deterministic_v1',
    selection_seed: selection.selection_seed,
    stratum_targets: selection.stratum_targets,
    actual_distribution: selection.actual_distribution,
    selection_notes: selection.selection_notes,
    track_ids: selection.track_ids,
    per_track: selection.selected_rows,
  };

  const snapshot = {
    schema_version: 1,
    built_at,
    protected_files_sha256: {
      phase_e_candidates_imported: file_sha256(FILE_PHASE_E_CANDIDATES_IMPORTED),
      manual_overrides: file_sha256(FILE_MANUAL_OVERRIDES),
      v2_candidates: file_sha256(FILE_AI_CANDIDATES_V2),
      v2_review: file_sha256(FILE_AI_REVIEW_V2),
    },
    note: '建立抽樣時指紋；品質驗證不得修改上述檔案',
  };

  if (options.write !== false) {
    fs.mkdirSync(PHASE_F_DIR, { recursive: true });
    write_json_atomic(FILE_PHASE_F_SAMPLE, sample_doc);
    write_json_atomic(FILE_PHASE_F_SELECTION_MANIFEST, manifest);
    write_json_atomic(FILE_PHASE_F_BUILD_SNAPSHOT, snapshot);
  }

  return { sample_doc, manifest, snapshot, selection };
}

export function load_phase_f_sample() {
  return read_json(FILE_PHASE_F_SAMPLE);
}
