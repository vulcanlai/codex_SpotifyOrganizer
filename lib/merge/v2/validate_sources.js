/**
 * 讀取並驗證 V2 合併來源（唯讀）
 */
import fs from 'node:fs';
import {
  FILE_LIBRARY_V1,
  FILE_MERGE_SUMMARY_V1,
  FILE_SAVED_ALBUMS,
  FILE_ALBUM_TRACKS,
  FILE_LIBRARY_SUMMARY,
  FILE_FOLLOWED_ARTISTS,
  FILE_FOLLOWED_SUMMARY,
  SCHEMA_VERSION_V1,
} from './paths.js';

export class MergeV2SourceError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [details]
   */
  constructor(message, details) {
    super(message);
    this.name = 'MergeV2SourceError';
    this.details = details || [];
  }
}

/**
 * @param {string} file_path
 * @param {string} label
 */
function read_json_required(file_path, label) {
  if (!fs.existsSync(file_path)) {
    throw new MergeV2SourceError(`缺少來源檔：${label}`, [file_path]);
  }
  try {
    return JSON.parse(fs.readFileSync(file_path, 'utf8'));
  } catch (err) {
    throw new MergeV2SourceError(`無法解析 ${label}`, [
      err && err.message ? err.message : String(err),
    ]);
  }
}

/**
 * @param {object} doc
 * @param {number} expected_schema
 * @param {string} label
 */
function assert_schema_version(doc, expected_schema, label) {
  if (!doc || doc.schema_version !== expected_schema) {
    throw new MergeV2SourceError(`${label} schema_version 不符`, [
      `預期 ${expected_schema}，實際 ${doc && doc.schema_version}`,
    ]);
  }
}

/**
 * @returns {object}
 */
export function load_and_validate_sources() {
  const library_v1 = read_json_required(FILE_LIBRARY_V1, 'library.json');
  assert_schema_version(library_v1, SCHEMA_VERSION_V1, 'library.json');

  const merge_summary_v1 = read_json_required(
    FILE_MERGE_SUMMARY_V1,
    'merge-summary.json'
  );
  assert_schema_version(merge_summary_v1, SCHEMA_VERSION_V1, 'merge-summary.json');

  if (merge_summary_v1.library_data_complete !== true) {
    throw new MergeV2SourceError(
      'merge-summary.json 標示 library_data_complete 不為 true，停止合併 V2。',
      merge_summary_v1.unimported_restricted_playlists || []
    );
  }

  const saved_albums_doc = read_json_required(
    FILE_SAVED_ALBUMS,
    'saved-albums.json'
  );
  assert_schema_version(saved_albums_doc, SCHEMA_VERSION_V1, 'saved-albums.json');

  const album_tracks_doc = read_json_required(
    FILE_ALBUM_TRACKS,
    'album-tracks.json'
  );
  assert_schema_version(album_tracks_doc, SCHEMA_VERSION_V1, 'album-tracks.json');

  const library_summary = read_json_required(
    FILE_LIBRARY_SUMMARY,
    'library-summary.json'
  );
  assert_schema_version(
    library_summary,
    SCHEMA_VERSION_V1,
    'library-summary.json'
  );

  if (library_summary.library_albums_backup_complete !== true) {
    throw new MergeV2SourceError(
      'library-summary.json 標示專輯備份未完成，停止合併 V2。'
    );
  }

  const followed_artists_doc = read_json_required(
    FILE_FOLLOWED_ARTISTS,
    'followed-artists.json'
  );
  assert_schema_version(
    followed_artists_doc,
    SCHEMA_VERSION_V1,
    'followed-artists.json'
  );

  if (followed_artists_doc.pagination_complete !== true) {
    throw new MergeV2SourceError(
      'followed-artists.json pagination_complete 不為 true，停止合併 V2。'
    );
  }

  const followed_summary = read_json_required(
    FILE_FOLLOWED_SUMMARY,
    'followed-artists-summary.json'
  );
  assert_schema_version(
    followed_summary,
    SCHEMA_VERSION_V1,
    'followed-artists-summary.json'
  );

  if (followed_summary.followed_artists_backup_complete !== true) {
    throw new MergeV2SourceError(
      'followed-artists-summary.json 標示追蹤藝人備份未完成，停止合併 V2。'
    );
  }

  const index_v1 = library_v1.track_index_by_spotify_id;
  if (!index_v1 || typeof index_v1 !== 'object' || Array.isArray(index_v1)) {
    throw new MergeV2SourceError(
      'library.json 的 track_index_by_spotify_id 必須為物件。'
    );
  }

  const v1_unique = Object.keys(index_v1).length;
  const expected_unique =
    merge_summary_v1.counts &&
    merge_summary_v1.counts.unique_tracks_by_spotify_id;
  if (
    typeof expected_unique === 'number' &&
    v1_unique !== expected_unique
  ) {
    throw new MergeV2SourceError(
      'library.json 索引筆數與 merge-summary.json unique_tracks_by_spotify_id 不一致。',
      [`index=${v1_unique}`, `summary=${expected_unique}`]
    );
  }

  return {
    library_v1,
    merge_summary_v1,
    saved_albums_doc,
    album_tracks_doc,
    library_summary,
    followed_artists_doc,
    followed_summary,
  };
}

/**
 * 統計專輯曲目來源
 * @param {object} album_tracks_doc
 * @param {object} saved_albums_doc
 */
export function count_album_track_sources(album_tracks_doc, saved_albums_doc) {
  const saved_by_id = {};
  if (saved_albums_doc && Array.isArray(saved_albums_doc.albums)) {
    for (let i = 0; i < saved_albums_doc.albums.length; i += 1) {
      const a = saved_albums_doc.albums[i];
      if (a && a.album_id) {
        saved_by_id[a.album_id] = a;
      }
    }
  }

  let album_sections = 0;
  let track_rows = 0;
  let track_rows_with_id = 0;
  let albums_not_ok = 0;

  const sections = album_tracks_doc.albums || [];
  for (let s = 0; s < sections.length; s += 1) {
    album_sections += 1;
    const sec = sections[s];
    if (!sec || sec.read_status !== 'ok') {
      albums_not_ok += 1;
      continue;
    }
    const tracks = Array.isArray(sec.tracks) ? sec.tracks : [];
    for (let t = 0; t < tracks.length; t += 1) {
      track_rows += 1;
      if (tracks[t] && tracks[t].spotify_id) {
        track_rows_with_id += 1;
      }
    }
    if (sec.album_id && !saved_by_id[sec.album_id]) {
      throw new MergeV2SourceError(
        `album-tracks 含專輯 ${sec.album_id}，但 saved-albums 缺少對應項目。`
      );
    }
  }

  if (albums_not_ok > 0) {
    throw new MergeV2SourceError(
      'album-tracks.json 存在未完成讀取的專輯區段，停止合併 V2。',
      [`albums_not_ok=${albums_not_ok}`]
    );
  }

  return {
    album_sections,
    track_rows,
    track_rows_with_id,
    saved_albums_count: saved_albums_doc.albums
      ? saved_albums_doc.albums.length
      : 0,
  };
}
