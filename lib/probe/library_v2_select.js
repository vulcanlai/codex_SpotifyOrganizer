/**
 * 從 library-v2 唯讀選取缺 metadata 的歌曲（不寫入檔案）
 */
import fs from 'node:fs';
import {
  FILE_LIBRARY_V2,
  FILE_MERGE_SUMMARY_V2,
} from '../merge/v2/paths.js';
import { is_weak_metadata_value } from '../merge/v2/metadata_merge.js';

export class LibraryV2ProbeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LibraryV2ProbeError';
  }
}

/**
 * @param {object|null} row
 */
export function is_id_only_track_row(row) {
  if (!row || typeof row !== 'object' || !row.spotify_id) {
    return false;
  }
  if (!is_weak_metadata_value(row.name)) {
    return false;
  }
  const has_artists =
    (Array.isArray(row.artists) && row.artists.length > 0) ||
    (Array.isArray(row.artist_details) &&
      row.artist_details.some(function (a) {
        return a && (a.name || a.id);
      }));
  if (has_artists) {
    return false;
  }
  if (!is_weak_metadata_value(row.album_name)) {
    return false;
  }
  if (!is_weak_metadata_value(row.release_date)) {
    return false;
  }
  return true;
}

/**
 * @param {Record<string, object>} track_index
 * @param {number} limit
 */
export function select_id_only_tracks_from_index(track_index, limit) {
  const cap = typeof limit === 'number' && limit > 0 ? limit : 10;
  const ids = Object.keys(track_index || {}).sort();
  /** @type {string[]} */
  const selected = [];
  for (let i = 0; i < ids.length && selected.length < cap; i += 1) {
    const id = ids[i];
    if (is_id_only_track_row(track_index[id])) {
      selected.push(id);
    }
  }
  return selected;
}

/**
 * 唯讀載入 library-v2 與摘要旗標
 */
export function load_library_v2_for_probe() {
  if (!fs.existsSync(FILE_MERGE_SUMMARY_V2)) {
    throw new LibraryV2ProbeError(
      '缺少 merge-summary-v2.json，請先執行 npm run merge:library-v2。'
    );
  }
  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(FILE_MERGE_SUMMARY_V2, 'utf8'));
  } catch (err) {
    throw new LibraryV2ProbeError(
      `無法解析 merge-summary-v2.json：${err && err.message ? err.message : err}`
    );
  }
  if (summary.library_v2_merge_complete !== true) {
    throw new LibraryV2ProbeError(
      'merge-summary-v2.json 標示 library_v2_merge_complete 不為 true，停止 probe。'
    );
  }

  if (!fs.existsSync(FILE_LIBRARY_V2)) {
    throw new LibraryV2ProbeError('缺少 library-v2.json。');
  }
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(FILE_LIBRARY_V2, 'utf8'));
  } catch (err) {
    throw new LibraryV2ProbeError(
      `無法解析 library-v2.json：${err && err.message ? err.message : err}`
    );
  }
  if (doc.schema_version !== 2) {
    throw new LibraryV2ProbeError(
      `library-v2.json schema_version 預期 2，實際 ${doc.schema_version}。`
    );
  }
  const index = doc.track_index_by_spotify_id;
  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    throw new LibraryV2ProbeError(
      'library-v2.json 缺少有效的 track_index_by_spotify_id 物件。'
    );
  }

  return {
    library_v2_doc: doc,
    merge_summary_v2: summary,
    track_index: index,
  };
}
