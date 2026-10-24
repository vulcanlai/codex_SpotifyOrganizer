/**
 * MVP 智慧歌單 Spotify 同步 manifest（本機）
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../atomic_json.js';

export const MVP_SYNC_MANIFEST_SCHEMA_VERSION = 1;

export const SYNC_STATUS_PENDING = 'pending';
export const SYNC_STATUS_CREATED = 'created';
export const SYNC_STATUS_SYNCING = 'syncing';
export const SYNC_STATUS_COMPLETE = 'complete';
export const SYNC_STATUS_FAILED = 'failed';
export const SYNC_STATUS_INTERRUPTED = 'interrupted';

export const DEFAULT_MVP_SYNC_MANIFEST_PATH = path.join(
  process.cwd(),
  'backup',
  'classification',
  'mvp-smart-playlists',
  'sync-manifest.json'
);

export function empty_sync_manifest() {
  return {
    schema_version: MVP_SYNC_MANIFEST_SCHEMA_VERSION,
    updated_at: null,
    sync_generation: 'mvp-smart-playlists:v2-lang-genre',
    playlists: {},
  };
}

/**
 * @param {string} [file_path]
 */
export function load_sync_manifest(file_path) {
  const p = file_path || DEFAULT_MVP_SYNC_MANIFEST_PATH;
  if (!fs.existsSync(p)) {
    return empty_sync_manifest();
  }
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!doc.playlists) {
    doc.playlists = {};
  }
  return doc;
}

/**
 * @param {object} doc
 * @param {string} [file_path]
 */
export function save_sync_manifest(doc, file_path) {
  const p = file_path || DEFAULT_MVP_SYNC_MANIFEST_PATH;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const next = {
    ...doc,
    schema_version: MVP_SYNC_MANIFEST_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
  };
  write_json_atomic(p, next);
  return next;
}

/**
 * @param {object} manifest
 * @param {string} mvp_playlist_id
 */
export function get_manifest_playlist_row(manifest, mvp_playlist_id) {
  return (manifest.playlists && manifest.playlists[mvp_playlist_id]) || null;
}

/**
 * sync-manifest 內已建立之 Spotify 歌單 ID（僅這些 ID 自原始曲庫備份／合併排除）
 * @param {object} manifest
 * @returns {Set<string>}
 */
export function mvp_sync_spotify_playlist_id_set(manifest) {
  const ids = new Set();
  const rows = (manifest && manifest.playlists) || {};
  const keys = Object.keys(rows);
  for (let i = 0; i < keys.length; i += 1) {
    const sid = rows[keys[i]] && rows[keys[i]].spotify_playlist_id;
    if (typeof sid === 'string' && sid.length > 0) {
      ids.add(sid);
    }
  }
  return ids;
}

/**
 * @param {string} [file_path]
 */
export function load_mvp_sync_spotify_playlist_id_set(file_path) {
  return mvp_sync_spotify_playlist_id_set(load_sync_manifest(file_path));
}

/** 備份 playlist-tracks.json 的 read_status：略過下載曲目，不計入失敗 */
export const BACKUP_READ_STATUS_EXCLUDED_MVP_SYNC = 'excluded_mvp_sync';
