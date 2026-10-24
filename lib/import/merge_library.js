/**
 * 合併 API 備份與手動匯入，建立去重索引（以 spotify_id 為鍵）
 */
import fs from 'node:fs';
import path from 'node:path';
import { project_root } from '../config.js';
import { write_json_atomic } from '../atomic_json.js';
import {
  load_mvp_sync_spotify_playlist_id_set,
  BACKUP_READ_STATUS_EXCLUDED_MVP_SYNC,
} from '../classification/mvp_playlist_sync_manifest.js';

const BACKUP_DIR = path.join(project_root, 'backup');
const MERGED_DIR = path.join(BACKUP_DIR, 'merged');

/**
 * @param {object|null} doc
 * @returns {object[]}
 */
export function api_playlist_entries_from_backup(doc, excluded_spotify_playlist_ids) {
  const entries = [];
  const excluded =
    excluded_spotify_playlist_ids || load_mvp_sync_spotify_playlist_id_set();
  if (!doc || !Array.isArray(doc.playlists)) {
    return entries;
  }
  for (let p = 0; p < doc.playlists.length; p += 1) {
    const pl = doc.playlists[p];
    if (!pl || !Array.isArray(pl.tracks)) {
      continue;
    }
    if (
      pl.read_status === BACKUP_READ_STATUS_EXCLUDED_MVP_SYNC ||
      (pl.playlist_id && excluded.has(pl.playlist_id))
    ) {
      continue;
    }
    if (pl.read_status !== 'ok') {
      continue;
    }
    for (let t = 0; t < pl.tracks.length; t += 1) {
      const tr = pl.tracks[t];
      if (!tr || !tr.spotify_id) {
        continue;
      }
      entries.push({
        ...tr,
        source: 'api_backup',
      });
    }
  }
  return entries;
}

/**
 * @param {object} imported_doc
 * @returns {object[]}
 */
function manual_entries_from_import(imported_doc) {
  const entries = [];
  if (!imported_doc || !Array.isArray(imported_doc.playlists)) {
    return entries;
  }
  for (let p = 0; p < imported_doc.playlists.length; p += 1) {
    const pl = imported_doc.playlists[p];
    if (!pl || !Array.isArray(pl.tracks)) {
      continue;
    }
    for (let t = 0; t < pl.tracks.length; t += 1) {
      entries.push(pl.tracks[t]);
    }
  }
  return entries;
}

/**
 * @param {object[]} playlist_entries
 * @param {object[]} liked_tracks
 */
export function build_track_index(playlist_entries, liked_tracks) {
  /** @type {Record<string, object>} */
  const index = {};

  function add_appearance(track_id, appearance, meta) {
    if (!track_id) {
      return;
    }
    if (!index[track_id]) {
      index[track_id] = {
        spotify_id: track_id,
        uri: meta.uri || `spotify:track:${track_id}`,
        name: meta.name != null ? meta.name : null,
        artists: meta.artists || [],
        album_name: meta.album_name != null ? meta.album_name : null,
        release_date: meta.release_date != null ? meta.release_date : null,
        duration_ms: meta.duration_ms != null ? meta.duration_ms : null,
        appearances: [],
      };
    } else {
      if (meta.name && !index[track_id].name) {
        index[track_id].name = meta.name;
      }
      if (meta.artists && meta.artists.length && !index[track_id].artists.length) {
        index[track_id].artists = meta.artists;
      }
    }
    index[track_id].appearances.push(appearance);
  }

  for (let i = 0; i < playlist_entries.length; i += 1) {
    const e = playlist_entries[i];
    if (!e.spotify_id) {
      continue;
    }
    add_appearance(
      e.spotify_id,
      {
        kind: 'playlist',
        playlist_id: e.playlist_id,
        playlist_name: e.playlist_name,
        position: e.position,
        source: e.source,
      },
      e
    );
  }

  for (let i = 0; i < liked_tracks.length; i += 1) {
    const e = liked_tracks[i];
    if (!e.spotify_id) {
      continue;
    }
    add_appearance(
      e.spotify_id,
      {
        kind: 'liked',
        position: e.position,
        source: e.source || 'liked',
      },
      e
    );
  }

  return index;
}

/**
 * @param {object} params
 */
export function merge_backup_and_import(params) {
  const catalog = params.playlist_catalog || [];
  const imported_doc = params.imported_doc;
  const restricted_pending = params.unimported_restricted || [];

  let api_tracks_doc = null;
  let liked_doc = null;
  const api_tracks_path = path.join(BACKUP_DIR, 'playlist-tracks.json');
  const liked_path = path.join(BACKUP_DIR, 'liked-tracks.json');
  if (fs.existsSync(api_tracks_path)) {
    api_tracks_doc = JSON.parse(fs.readFileSync(api_tracks_path, 'utf8'));
  }
  if (fs.existsSync(liked_path)) {
    liked_doc = JSON.parse(fs.readFileSync(liked_path, 'utf8'));
  }

  const excluded_ids = load_mvp_sync_spotify_playlist_id_set();
  const api_entries = api_playlist_entries_from_backup(api_tracks_doc, excluded_ids);
  const manual_entries = manual_entries_from_import(imported_doc);
  const playlist_track_entries = api_entries.concat(manual_entries);

  const liked_tracks =
    liked_doc && Array.isArray(liked_doc.tracks) ? liked_doc.tracks : [];

  const track_index_by_spotify_id = build_track_index(
    playlist_track_entries,
    liked_tracks
  );

  const unique_merged_tracks = Object.keys(track_index_by_spotify_id).length;

  const restricted_total = catalog.filter(function (pl) {
    return pl.read_status === 'restricted' || pl.ownership === 'restricted';
  }).length;

  const library_data_complete =
    restricted_total === 0 || restricted_pending.length === 0;

  const merged_doc = {
    schema_version: 1,
    merged_at: new Date().toISOString(),
    user_id: params.user_id || null,
    playlist_track_entries,
    liked_tracks,
    track_index_by_spotify_id,
  };

  const merge_summary = {
    schema_version: 1,
    merged_at: merged_doc.merged_at,
    counts: {
      api_playlist_track_entries: api_entries.length,
      manual_import_track_entries: manual_entries.length,
      playlist_track_entries_total: playlist_track_entries.length,
      liked_tracks: liked_tracks.length,
      unique_tracks_by_spotify_id: unique_merged_tracks,
    },
    restricted_playlists_total: restricted_total,
    unimported_restricted_playlists: restricted_pending,
    library_data_complete,
    note: library_data_complete
      ? null
      : '仍有受限制歌單尚未手動匯入，整體音樂庫資料尚未齊全。',
  };

  write_json_atomic(path.join(MERGED_DIR, 'library.json'), merged_doc);
  write_json_atomic(path.join(MERGED_DIR, 'merge-summary.json'), merge_summary);

  return merge_summary;
}
