/**
 * Phase 1A：80 首固定 seed 分層抽樣與證據盤點（唯讀，無 AI 推論）
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { load_g3_f_adopt_registry } from '../g3_f/g3_f_adopt_registry_store.js';
import { FILE_CLASSIFICATION_INDEX } from '../paths.js';
import { load_track_cache } from '../../enrichment/storage.js';
import { is_metadata_cache_complete } from '../../enrichment/track_entry.js';
import { cache_entry_trusted_for_merge } from '../../enrichment/metadata_cache_guard.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import {
  EMOTION_TRIAL_1A_SEED,
  EMOTION_TRIAL_1A_COUNTS,
  EMOTION_TRIAL_1A_TOTAL,
  EMOTION_TRIAL_1A_STRATUM,
} from './emotion_trial_paths.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';

export const EMOTION_READINESS_INSUFFICIENT = 'evidence_insufficient';
export const EMOTION_READINESS_ELIGIBLE = 'eligible_for_emotion_inference';

/**
 * @param {string} seed_str
 */
export function seed_to_mulberry32_state(seed_str) {
  const h = crypto.createHash('sha256').update(String(seed_str)).digest();
  return h.readUInt32BE(0);
}

/**
 * @param {number} a
 */
export function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {string[]} ids
 * @param {string} seed
 */
export function shuffle_track_ids(ids, seed) {
  const rand = mulberry32(seed_to_mulberry32_state(seed));
  const arr = ids.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * @param {object} registry_doc
 * @returns {Set<string>}
 */
export function g3_f_high_adopted_track_ids(registry_doc) {
  const out = new Set();
  const map = (registry_doc && registry_doc.adoptions_by_track_id) || {};
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i += 1) {
    const id = keys[i];
    const row = map[id];
    if (row && row.status === 'adopted' && row.confidence_tier === 'high') {
      out.add(id);
    }
  }
  return out;
}

/**
 * @param {object} index_doc
 * @param {Set<string>} high_ids
 */
export function build_stratum_pools(index_doc, high_ids) {
  const tracks = (index_doc && index_doc.tracks_by_id) || {};
  const ids = Object.keys(tracks).sort();
  /** @type {string[]} */
  const pool_high = [];
  /** @type {string[]} */
  const pool_complete_not_high = [];
  /** @type {string[]} */
  const pool_missing = [];

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const row = tracks[id];
    const status = row.metadata_status || 'metadata_missing';
    if (high_ids.has(id)) {
      pool_high.push(id);
      continue;
    }
    if (status === 'complete') {
      pool_complete_not_high.push(id);
    } else if (status === 'metadata_missing') {
      pool_missing.push(id);
    }
  }

  return {
    pool_high: pool_high,
    pool_complete_not_high: pool_complete_not_high,
    pool_missing: pool_missing,
    library_track_count: ids.length,
  };
}

/**
 * 專案內是否存在 Spotify Audio Features 或同等聽感特徵（Phase 1A 盤點用）
 * @param {object|null} cache_entry
 */
export function track_has_direct_audio_evidence(cache_entry) {
  if (!cache_entry || !cache_entry_trusted_for_merge(cache_entry.spotify_id, cache_entry)) {
    return false;
  }
  if (cache_entry.audio_features && typeof cache_entry.audio_features === 'object') {
    return true;
  }
  if (cache_entry.direct_audio_verified === true) {
    return true;
  }
  return false;
}

/**
 * @param {object|null} evidence_track
 */
export function track_has_reliable_lyric_evidence(evidence_track) {
  if (!evidence_track || !Array.isArray(evidence_track.facts)) {
    return false;
  }
  const facts = evidence_track.facts;
  for (let i = 0; i < facts.length; i += 1) {
    const f = facts[i];
    if (!f || f.is_direct_fact !== true) {
      continue;
    }
    const field = String(f.field || '').toLowerCase();
    if (
      field === 'lyric_text' ||
      field === 'lyrics' ||
      field === 'lyric_language_verified' ||
      field === 'lyric_content'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * @param {object} index_row
 */
export function track_has_weak_metadata_clues(index_row) {
  const display = index_row.display || {};
  const has_title = !!(display.name && String(display.name).trim());
  const has_artists =
    Array.isArray(display.artists) && display.artists.length > 0;
  const has_album = !!(display.album_name && String(display.album_name).trim());
  return has_title || has_artists || has_album;
}

/**
 * @param {object} index_row
 * @param {object|null} cache_entry
 * @param {object|null} evidence_track
 */
export function assess_emotion_evidence_readiness(index_row, cache_entry, evidence_track) {
  const has_audio = track_has_direct_audio_evidence(cache_entry);
  const has_lyrics = track_has_reliable_lyric_evidence(evidence_track);
  const weak_only =
    track_has_weak_metadata_clues(index_row) && !has_audio && !has_lyrics;
  const meets_minimum = has_audio || has_lyrics;
  return {
    has_direct_audio_evidence: has_audio,
    has_reliable_lyric_evidence: has_lyrics,
    weak_clues_only: weak_only,
    meets_minimum_emotion_evidence: meets_minimum,
    emotion_readiness:
      meets_minimum ? EMOTION_READINESS_ELIGIBLE : EMOTION_READINESS_INSUFFICIENT,
    evidence_note_zh: meets_minimum
      ? '具強證據來源，可進入 Agent 情緒推論（仍須遵守 Phase 0 validate）。'
      : '無直接音訊特徵或可靠歌詞事實；不得 inferred 情緒，僅可 unknown 或空標籤。',
  };
}

function genre_reference_display(index_row, registry_row) {
  const gp =
    (registry_row &&
      registry_row.status === 'adopted' &&
      registry_row.adopted_classification &&
      registry_row.adopted_classification.genre_profile) ||
    index_row.genre_profile ||
    null;
  if (!gp) {
    return { primary_genre: GENRE_PRIMARY_UNKNOWN, label_zh: '未確認', source: 'none' };
  }
  const pk = gp.primary_genre || GENRE_PRIMARY_UNKNOWN;
  let source = gp.source || 'classification-index';
  if (registry_row && registry_row.status === 'adopted') {
    source = 'g3-f-adopt-registry.json';
  }
  return {
    primary_genre: pk,
    label_zh: pk === GENRE_PRIMARY_UNKNOWN ? '未確認' : pk,
    source: source,
    reference_only: true,
  };
}

/**
 * @param {object} opts
 */
export function select_emotion_trial_1a_sample(opts) {
  const options = opts || {};
  const seed = options.seed || EMOTION_TRIAL_1A_SEED;
  const index_doc =
    options.index_doc ||
    JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8'));
  const registry_doc =
    options.registry_doc ||
    load_g3_f_adopt_registry(
      options.registry_file_path ? { file_path: options.registry_file_path } : undefined
    );
  const high_ids = g3_f_high_adopted_track_ids(registry_doc);
  const pools = build_stratum_pools(index_doc, high_ids);

  const need_high = EMOTION_TRIAL_1A_COUNTS[EMOTION_TRIAL_1A_STRATUM.G3_F_HIGH];
  const need_complete =
    EMOTION_TRIAL_1A_COUNTS[EMOTION_TRIAL_1A_STRATUM.METADATA_COMPLETE];
  const need_missing =
    EMOTION_TRIAL_1A_COUNTS[EMOTION_TRIAL_1A_STRATUM.METADATA_MISSING];

  if (pools.pool_high.length < need_high) {
    throw new Error(
      'G3-F High 池不足：' + pools.pool_high.length + ' < ' + need_high
    );
  }
  if (pools.pool_complete_not_high.length < need_complete) {
    throw new Error(
      'metadata complete 池不足：' +
        pools.pool_complete_not_high.length +
        ' < ' +
        need_complete
    );
  }
  if (pools.pool_missing.length < need_missing) {
    throw new Error(
      'metadata missing 池不足：' + pools.pool_missing.length + ' < ' + need_missing
    );
  }

  const picked_high = shuffle_track_ids(pools.pool_high, seed + ':stratum:high').slice(
    0,
    need_high
  );
  const picked_complete = shuffle_track_ids(
    pools.pool_complete_not_high,
    seed + ':stratum:complete'
  ).slice(0, need_complete);
  const picked_missing = shuffle_track_ids(
    pools.pool_missing,
    seed + ':stratum:missing'
  ).slice(0, need_missing);

  const all = picked_high.concat(picked_complete, picked_missing);
  const uniq = new Set(all);
  if (uniq.size !== EMOTION_TRIAL_1A_TOTAL) {
    throw new Error('抽樣 ID 重複');
  }

  return {
    seed: seed,
    library_track_count: pools.library_track_count,
    pool_sizes: {
      g3_f_high_genre: pools.pool_high.length,
      metadata_complete_not_high: pools.pool_complete_not_high.length,
      metadata_missing: pools.pool_missing.length,
    },
    g3_f_high_adopted_count: high_ids.size,
    strata: {
      g3_f_high_genre: picked_high,
      metadata_complete_not_high: picked_complete,
      metadata_missing: picked_missing,
    },
    track_ids: all.sort(),
  };
}

/**
 * @param {object} sample_selection
 * @param {object} [opts]
 */
export function build_emotion_trial_1a_inventory(sample_selection, opts) {
  const options = opts || {};
  const index_doc =
    options.index_doc ||
    JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8'));
  const registry_doc =
    options.registry_doc ||
    load_g3_f_adopt_registry(
      options.registry_file_path ? { file_path: options.registry_file_path } : undefined
    );
  const cache_doc = options.cache_doc || load_track_cache();
  const cache_by_id = cache_doc.tracks_by_id || {};

  let evidence_by_id = options.evidence_by_id || null;
  if (!evidence_by_id && options.evidence_index_path) {
    const ev = JSON.parse(fs.readFileSync(options.evidence_index_path, 'utf8'));
    evidence_by_id = ev.tracks || {};
  }
  if (!evidence_by_id && options.skip_evidence !== true) {
    const ev_path = file_g3_evidence_index();
    if (fs.existsSync(ev_path)) {
      const ev = JSON.parse(fs.readFileSync(ev_path, 'utf8'));
      evidence_by_id = ev.tracks || {};
    } else {
      evidence_by_id = {};
    }
  }
  evidence_by_id = evidence_by_id || {};

  const tracks = index_doc.tracks_by_id || {};
  const adoptions = registry_doc.adoptions_by_track_id || {};
  /** @type {object[]} */
  const rows = [];

  const stratum_map = {};
  const strata = sample_selection.strata;
  const keys = Object.keys(strata);
  for (let s = 0; s < keys.length; s += 1) {
    const stratum = keys[s];
    const list = strata[stratum];
    for (let i = 0; i < list.length; i += 1) {
      stratum_map[list[i]] = stratum;
    }
  }

  const ids = sample_selection.track_ids.slice().sort();
  for (let j = 0; j < ids.length; j += 1) {
    const id = ids[j];
    const row = tracks[id] || { spotify_id: id };
    const cache_entry = cache_by_id[id] || null;
    const ev_row = evidence_by_id[id] || null;
    const registry_row = adoptions[id] || null;
    const display = row.display || {};
    const assessment = assess_emotion_evidence_readiness(row, cache_entry, ev_row);
    const genre_ref = genre_reference_display(row, registry_row);
    const enrichment_ok =
      row.enrichment_cache_complete === true ||
      (cache_entry &&
        cache_entry_trusted_for_merge(id, cache_entry) &&
        is_metadata_cache_complete(cache_entry));

    rows.push({
      track_id: id,
      stratum: stratum_map[id],
      title: display.name || null,
      artists: Array.isArray(display.artists) ? display.artists.slice() : [],
      album_name: display.album_name || null,
      genre_reference: genre_ref,
      metadata_status: row.metadata_status || 'metadata_missing',
      enrichment_cache_complete: enrichment_ok === true,
      duration_ms_present:
        !!(row.merged_metadata && row.merged_metadata.duration_ms != null),
      explicit_present:
        !!(cache_entry && cache_entry.explicit != null),
      not_emotion_evidence_zh:
        'duration_ms、explicit、歌名／歌手／專輯、曲風僅弱線索或參考，非直接情緒證據。',
      has_direct_audio_evidence: assessment.has_direct_audio_evidence,
      has_reliable_lyric_evidence: assessment.has_reliable_lyric_evidence,
      weak_clues_only: assessment.weak_clues_only,
      meets_minimum_emotion_evidence: assessment.meets_minimum_emotion_evidence,
      emotion_readiness: assessment.emotion_readiness,
      evidence_note_zh: assessment.evidence_note_zh,
    });
  }

  return rows;
}
