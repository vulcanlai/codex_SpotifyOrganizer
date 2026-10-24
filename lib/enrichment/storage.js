/**
 * enrichment 快取原子讀寫
 */
import fs from 'node:fs';
import {
  ENRICHMENT_DIR,
  FILE_TRACK_CACHE,
  FILE_CHECKPOINT,
  FILE_SUMMARY,
  CACHE_SCHEMA_VERSION,
  CHECKPOINT_SCHEMA_VERSION,
  SUMMARY_SCHEMA_VERSION,
} from './paths.js';
import { write_json_atomic } from '../atomic_json.js';
import { is_metadata_cache_complete } from './track_entry.js';

export class EnrichmentStorageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EnrichmentStorageError';
  }
}

function read_json(path) {
  if (!fs.existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (err) {
    throw new EnrichmentStorageError(
      `無法解析 ${path}：${err && err.message ? err.message : err}`
    );
  }
}

export function load_track_cache() {
  const doc = read_json(FILE_TRACK_CACHE);
  if (!doc) {
    return {
      schema_version: CACHE_SCHEMA_VERSION,
      updated_at: null,
      tracks_by_id: {},
    };
  }
  if (doc.schema_version !== CACHE_SCHEMA_VERSION) {
    throw new EnrichmentStorageError(
      `track-metadata-cache.json schema_version 不符（預期 ${CACHE_SCHEMA_VERSION}，實際 ${doc.schema_version}）。請人工處理。`
    );
  }
  if (!doc.tracks_by_id || typeof doc.tracks_by_id !== 'object') {
    throw new EnrichmentStorageError(
      'track-metadata-cache.json 缺少 tracks_by_id 物件。'
    );
  }
  return doc;
}

export function load_checkpoint() {
  const doc = read_json(FILE_CHECKPOINT);
  if (!doc) {
    return {
      schema_version: CHECKPOINT_SCHEMA_VERSION,
      updated_at: null,
      last_run_started_at: null,
      last_run_finished_at: null,
      last_track_id_processed: null,
      run_in_progress: false,
    };
  }
  if (doc.schema_version !== CHECKPOINT_SCHEMA_VERSION) {
    throw new EnrichmentStorageError(
      `checkpoint.json schema_version 不符（預期 ${CHECKPOINT_SCHEMA_VERSION}）。`
    );
  }
  return doc;
}

/**
 * 合併寫入單筆；完整 ok 不被 partial/錯誤覆蓋
 * @param {object} cache_doc
 * @param {string} track_id
 * @param {object} incoming
 */
export function merge_cache_entry(cache_doc, track_id, incoming) {
  const existing = cache_doc.tracks_by_id[track_id];
  if (existing && is_metadata_cache_complete(existing)) {
    if (!is_metadata_cache_complete(incoming)) {
      return false;
    }
  }
  cache_doc.tracks_by_id[track_id] = incoming;
  cache_doc.updated_at = new Date().toISOString();
  return true;
}

export function persist_enrichment_state(state) {
  if (!fs.existsSync(ENRICHMENT_DIR)) {
    fs.mkdirSync(ENRICHMENT_DIR, { recursive: true });
  }
  write_json_atomic(FILE_TRACK_CACHE, state.cache_doc);
  write_json_atomic(FILE_CHECKPOINT, state.checkpoint_doc);
  write_json_atomic(FILE_SUMMARY, state.summary_doc);
}

/**
 * @param {object} cache_doc
 */
export function count_cache_stats(cache_doc) {
  const ids = Object.keys(cache_doc.tracks_by_id || {});
  let ok = 0;
  let partial = 0;
  let not_found = 0;
  let forbidden = 0;
  let rate = 0;
  let network = 0;
  let other = 0;
  let playable = 0;
  let not_playable = 0;
  let play_unknown = 0;

  for (let i = 0; i < ids.length; i += 1) {
    const e = cache_doc.tracks_by_id[ids[i]];
    if (!e) {
      continue;
    }
    if (e.status === 'ok' && is_metadata_cache_complete(e)) {
      ok += 1;
    } else if (e.status === 'partial') {
      partial += 1;
    } else if (e.status === 'not_found_404') {
      not_found += 1;
    } else if (e.status === 'forbidden_403') {
      forbidden += 1;
    } else if (e.status === 'rate_limited_429') {
      rate += 1;
    } else if (e.status === 'network_error') {
      network += 1;
    } else {
      other += 1;
    }

    const ps = e.playability_status;
    if (ps === 'playable') {
      playable += 1;
    } else if (
      ps === 'not_playable' ||
      ps === 'restricted'
    ) {
      not_playable += 1;
    } else {
      play_unknown += 1;
    }
  }

  return {
    cached_entries: ids.length,
    cache_ok_complete: ok,
    cache_partial: partial,
    cache_not_found_404: not_found,
    cache_forbidden_403: forbidden,
    cache_rate_limited_429: rate,
    cache_network_error: network,
    cache_other: other,
    cache_playable: playable,
    cache_not_playable: not_playable,
    cache_play_unknown: play_unknown,
  };
}
