/**
 * 讀寫 backup/library/ 與 schema 驗證（不覆蓋無法安全合併的既有資料）
 */
import fs from 'node:fs';
import {
  LIBRARY_DIR,
  FILE_SAVED_ALBUMS,
  FILE_ALBUM_TRACKS,
  FILE_CHECKPOINT,
  FILE_LIBRARY_SUMMARY,
  SCHEMA_VERSION,
} from './paths.js';
import { write_json_atomic } from '../atomic_json.js';

export class LibraryStorageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LibraryStorageError';
  }
}

function read_json_if_exists(file_path) {
  if (!fs.existsSync(file_path)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file_path, 'utf8'));
  } catch (err) {
    throw new LibraryStorageError(
      `無法解析 ${file_path}：${err && err.message ? err.message : err}`
    );
  }
}

/**
 * @param {object|null} doc
 * @param {string} label
 */
function assert_schema(doc, label) {
  if (!doc) {
    return null;
  }
  if (doc.schema_version !== SCHEMA_VERSION) {
    throw new LibraryStorageError(
      `${label} schema_version 不符（預期 ${SCHEMA_VERSION}，實際 ${doc.schema_version}）。請人工處理後再執行。`
    );
  }
  return doc;
}

/**
 * 載入既有備份供中斷續傳
 */
export function load_existing_library_backup() {
  const saved = assert_schema(
    read_json_if_exists(FILE_SAVED_ALBUMS),
    'saved-albums.json'
  );
  const tracks = assert_schema(
    read_json_if_exists(FILE_ALBUM_TRACKS),
    'album-tracks.json'
  );

  if (saved && tracks) {
    const saved_ids = new Set();
    if (Array.isArray(saved.albums)) {
      for (let i = 0; i < saved.albums.length; i += 1) {
        const id = saved.albums[i] && saved.albums[i].album_id;
        if (id) {
          saved_ids.add(id);
        }
      }
    }
    const track_ids = new Set();
    if (Array.isArray(tracks.albums)) {
      for (let i = 0; i < tracks.albums.length; i += 1) {
        const sec = tracks.albums[i];
        if (sec && sec.album_id && sec.read_status === 'ok') {
          track_ids.add(sec.album_id);
        }
      }
    }
    for (const id of track_ids) {
      if (!saved_ids.has(id)) {
        throw new LibraryStorageError(
          `album-tracks.json 含已完成專輯 ${id}，但 saved-albums.json 缺少對應項目，無法安全合併。`
        );
      }
    }
  }

  return { saved, tracks };
}

/**
 * @param {object} meta - normalize_saved_album_row 後並更新狀態
 */
export function is_album_tracks_complete(meta, track_section) {
  if (!meta || !meta.album_id) {
    return false;
  }
  if (meta.tracks_read_status !== 'ok') {
    return false;
  }
  if (!track_section || track_section.read_status !== 'ok') {
    return false;
  }
  const fetched = meta.tracks_fetched_count;
  const api_total = meta.tracks_api_total;
  if (typeof api_total !== 'number') {
    return false;
  }
  return fetched === api_total;
}

/**
 * 依 album_id 合併既有曲目區段（重跑時跳過已完成）
 * @param {object|null} existing_tracks_doc
 * @returns {Record<string, object>}
 */
export function index_track_sections(existing_tracks_doc) {
  /** @type {Record<string, object>} */
  const map = {};
  if (!existing_tracks_doc || !Array.isArray(existing_tracks_doc.albums)) {
    return map;
  }
  for (let i = 0; i < existing_tracks_doc.albums.length; i += 1) {
    const sec = existing_tracks_doc.albums[i];
    if (sec && sec.album_id) {
      map[sec.album_id] = sec;
    }
  }
  return map;
}

/**
 * @param {object|null} existing_saved_doc
 * @returns {Record<string, object>}
 */
export function index_saved_albums(existing_saved_doc) {
  /** @type {Record<string, object>} */
  const map = {};
  if (!existing_saved_doc || !Array.isArray(existing_saved_doc.albums)) {
    return map;
  }
  for (let i = 0; i < existing_saved_doc.albums.length; i += 1) {
    const a = existing_saved_doc.albums[i];
    if (a && a.album_id) {
      map[a.album_id] = a;
    }
  }
  return map;
}

/**
 * @param {object} payload
 */
export function persist_library_backup(payload) {
  if (!fs.existsSync(LIBRARY_DIR)) {
    fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  }
  write_json_atomic(FILE_SAVED_ALBUMS, payload.saved_albums_doc);
  write_json_atomic(FILE_ALBUM_TRACKS, payload.album_tracks_doc);
  write_json_atomic(FILE_LIBRARY_SUMMARY, payload.summary_doc);
  write_json_atomic(FILE_CHECKPOINT, payload.checkpoint_doc);
}
