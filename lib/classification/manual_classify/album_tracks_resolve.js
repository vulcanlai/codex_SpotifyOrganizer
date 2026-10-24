/**
 * 從本機 album-tracks.json 解析專輯曲目（不呼叫 Spotify API）
 */
import fs from 'node:fs';
import { FILE_ALBUM_TRACKS } from '../../merge/v2/paths.js';
import { is_valid_spotify_id } from './spotify_id_parse.js';
import { resolve_allowed_data_file_path } from './safe_data_path.js';

/**
 * @param {object} [opts]
 */
export function load_album_tracks_doc(opts) {
  const options = opts || {};
  let file_path = FILE_ALBUM_TRACKS;
  if (options.album_tracks_path) {
    const allowed = resolve_allowed_data_file_path(options.album_tracks_path);
    if (!allowed) {
      return {
        doc: null,
        path: String(options.album_tracks_path),
        error: 'path_not_allowed',
      };
    }
    file_path = allowed;
  }
  if (!fs.existsSync(file_path)) {
    return { doc: null, path: file_path, error: 'missing_album_tracks_file' };
  }
  try {
    const doc = JSON.parse(fs.readFileSync(file_path, 'utf8'));
    return { doc: doc, path: file_path, error: null };
  } catch (err) {
    return {
      doc: null,
      path: file_path,
      error: 'parse_error:' + (err && err.message ? err.message : err),
    };
  }
}

/**
 * @param {object} doc
 * @param {string} album_id
 */
export function find_album_section(doc, album_id) {
  const albums = (doc && doc.albums) || [];
  for (let i = 0; i < albums.length; i += 1) {
    if (albums[i].album_id === album_id) {
      return albums[i];
    }
  }
  return null;
}

/**
 * @param {object} section
 */
export function album_section_track_ids(section) {
  /** @type {string[]} */
  const ids = [];
  const seen = {};
  const tracks = (section && section.tracks) || [];
  for (let i = 0; i < tracks.length; i += 1) {
    const tid = tracks[i].spotify_id;
    if (!is_valid_spotify_id(tid) || seen[tid]) {
      continue;
    }
    seen[tid] = true;
    ids.push(tid);
  }
  return ids.sort();
}

/**
 * @param {string} album_id
 * @param {object} [opts]
 */
export function resolve_album_track_ids(album_id, opts) {
  const options = opts || {};
  if (!is_valid_spotify_id(album_id)) {
    return {
      album_id: album_id,
      ok: false,
      error: 'invalid_album_id',
      track_ids: [],
      incomplete: false,
    };
  }
  const loaded = load_album_tracks_doc(options);
  if (!loaded.doc) {
    return {
      album_id: album_id,
      ok: false,
      error: loaded.error || 'missing_album_tracks',
      track_ids: [],
      incomplete: false,
      note_zh: '本機找不到 album-tracks.json；請先備份專輯或待 API 恢復後補資料。',
    };
  }
  const section = find_album_section(loaded.doc, album_id);
  if (!section) {
    return {
      album_id: album_id,
      ok: false,
      error: 'album_not_in_local_cache',
      track_ids: [],
      incomplete: false,
      note_zh: '本機 album-tracks 無此專輯；不可猜測曲目清單。',
    };
  }
  if (section.read_status && section.read_status !== 'ok') {
    return {
      album_id: album_id,
      album_name: section.album_name || null,
      ok: false,
      error: 'album_read_incomplete',
      read_status: section.read_status,
      track_ids: album_section_track_ids(section),
      incomplete: true,
      note_zh: '專輯曲目讀取未完成，僅能使用已快取的部分曲目。',
    };
  }
  const track_ids = album_section_track_ids(section);
  let incomplete = false;
  if (
    section.total_tracks != null &&
    typeof section.total_tracks === 'number' &&
    track_ids.length < section.total_tracks
  ) {
    incomplete = true;
  }
  return {
    album_id: album_id,
    album_name: section.album_name || null,
    ok: track_ids.length > 0,
    error: track_ids.length ? null : 'album_empty_tracks',
    track_ids: track_ids,
    incomplete: incomplete,
    total_tracks_expected: section.total_tracks != null ? section.total_tracks : null,
    note_zh: incomplete
      ? '專輯曲目清單可能不完整（快取曲目數少於 total_tracks）。'
      : null,
  };
}

/**
 * @param {string[]} album_ids
 * @param {object} [opts]
 */
export function resolve_many_albums(album_ids, opts) {
  /** @type {object[]} */
  const albums = [];
  /** @type {Set<string>} */
  const all_tracks = new Set();
  for (let i = 0; i < album_ids.length; i += 1) {
    const res = resolve_album_track_ids(album_ids[i], opts);
    albums.push(res);
    for (let t = 0; t < res.track_ids.length; t += 1) {
      all_tracks.add(res.track_ids[t]);
    }
  }
  return {
    albums: albums,
    track_ids: Array.from(all_tracks).sort(),
  };
}
