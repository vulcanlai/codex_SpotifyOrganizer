/**
 * 追蹤藝人備份讀寫（失敗時不覆蓋上一次完整備份）
 */
import fs from 'node:fs';
import {
  LIBRARY_DIR,
  FILE_FOLLOWED_ARTISTS,
  FILE_FOLLOWED_SUMMARY,
  FILE_FOLLOWED_CHECKPOINT,
  SCHEMA_VERSION,
} from './paths.js';
import { write_json_atomic } from '../atomic_json.js';

export class FollowedArtistsStorageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FollowedArtistsStorageError';
  }
}

function read_json_if_exists(file_path) {
  if (!fs.existsSync(file_path)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file_path, 'utf8'));
  } catch (err) {
    throw new FollowedArtistsStorageError(
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
    throw new FollowedArtistsStorageError(
      `${label} schema_version 不符（預期 ${SCHEMA_VERSION}，實際 ${doc.schema_version}）。`
    );
  }
  return doc;
}

export function load_existing_followed_artists() {
  return assert_schema(
    read_json_if_exists(FILE_FOLLOWED_ARTISTS),
    'followed-artists.json'
  );
}

export function load_followed_checkpoint() {
  return assert_schema(
    read_json_if_exists(FILE_FOLLOWED_CHECKPOINT),
    'followed-artists-checkpoint.json'
  );
}

/**
 * 是否允許寫入 followed-artists.json（完整分頁成功才覆寫）
 * @param {{ pagination_complete: boolean, fetch_failed: boolean }} run_state
 * @param {object|null} existing
 */
export function should_replace_followed_artists_file(run_state, existing) {
  if (run_state.fetch_failed) {
    return false;
  }
  if (!run_state.pagination_complete) {
    return false;
  }
  if (
    existing &&
    existing.pagination_complete === true &&
    run_state.pagination_complete !== true
  ) {
    return false;
  }
  return true;
}

/**
 * @param {object} payload
 * @param {{ write_artists_file: boolean }} options
 */
export function persist_followed_artists_backup(payload, options) {
  const opts = options || {};
  if (!fs.existsSync(LIBRARY_DIR)) {
    fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  }
  if (opts.write_artists_file && payload.artists_doc) {
    write_json_atomic(FILE_FOLLOWED_ARTISTS, payload.artists_doc);
  }
  write_json_atomic(FILE_FOLLOWED_SUMMARY, payload.summary_doc);
  write_json_atomic(FILE_FOLLOWED_CHECKPOINT, payload.checkpoint_doc);
}

/**
 * 完整備份成功後，比較上一版 artist_id（僅供 summary，不刪歷史檔內容）
 * @param {object|null} previous_complete
 * @param {object[]} new_artists
 */
export function detect_unfollowed_since_last(previous_complete, new_artists) {
  if (!previous_complete || !Array.isArray(previous_complete.artists)) {
    return { compared: false, unfollowed_artist_ids: [] };
  }
  const prev_ids = new Set();
  for (let i = 0; i < previous_complete.artists.length; i += 1) {
    const id = previous_complete.artists[i].artist_id;
    if (id) {
      prev_ids.add(id);
    }
  }
  const next_ids = new Set();
  for (let j = 0; j < new_artists.length; j += 1) {
    const nid = new_artists[j].artist_id;
    if (nid) {
      next_ids.add(nid);
    }
  }
  /** @type {string[]} */
  const unfollowed = [];
  for (const pid of prev_ids) {
    if (!next_ids.has(pid)) {
      unfollowed.push(pid);
    }
  }
  return { compared: true, unfollowed_artist_ids: unfollowed };
}
