/**
 * 從 classification-index + enrichment 快取組裝查證輸入（不呼叫 Spotify API）
 */
import fs from 'node:fs';
import { FILE_CLASSIFICATION_INDEX } from '../../classification/paths.js';
import { FILE_TRACK_CACHE } from '../paths.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

let index_cache = null;
let track_cache_mem = null;

export function reset_track_input_cache_for_tests() {
  index_cache = null;
  track_cache_mem = null;
}

export function load_index_tracks() {
  if (index_cache) {
    return index_cache;
  }
  const doc = read_json(FILE_CLASSIFICATION_INDEX);
  if (!doc || !doc.tracks_by_id) {
    throw new Error('缺少 classification-index.json');
  }
  index_cache = doc.tracks_by_id;
  return index_cache;
}

export function load_metadata_cache() {
  if (track_cache_mem) {
    return track_cache_mem;
  }
  const doc = read_json(FILE_TRACK_CACHE);
  track_cache_mem = doc && doc.tracks_by_id ? doc.tracks_by_id : {};
  return track_cache_mem;
}

/**
 * @param {string} spotify_id
 */
export function build_external_track_input(spotify_id) {
  const tracks = load_index_tracks();
  const row = tracks[spotify_id];
  if (!row) {
    return null;
  }
  const disp = row.display || {};
  const artists = (disp.artists || []).map(function (a) {
    return String(a).trim();
  });
  const meta = load_metadata_cache()[spotify_id] || {};
  let isrc = null;
  if (meta.isrc) {
    isrc = String(meta.isrc).trim();
  } else if (meta.external_ids && meta.external_ids.isrc) {
    isrc = String(meta.external_ids.isrc).trim();
  }
  let duration_ms = null;
  if (typeof meta.duration_ms === 'number') {
    duration_ms = meta.duration_ms;
  } else if (row.merged_metadata && typeof row.merged_metadata.duration_ms === 'number') {
    duration_ms = row.merged_metadata.duration_ms;
  }
  return {
    spotify_id: spotify_id,
    title: String(disp.name || '').trim(),
    artists: artists,
    album_name: disp.album_name ? String(disp.album_name).trim() : '',
    isrc: isrc,
    duration_ms: duration_ms,
    release_date:
      (row.merged_metadata && row.merged_metadata.release_date) ||
      (meta.album && meta.album.release_date) ||
      null,
    metadata_status: row.metadata_status || 'unknown',
  };
}
