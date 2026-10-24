/**
 * 組裝 library-v2（僅本機 JSON，不呼叫 API）
 */
import {
  clone_appearances,
  push_appearance_unique,
} from './appearances.js';
import {
  merge_track_metadata,
  compute_metadata_stats,
  playability_from_legacy,
  artist_details_from_any,
} from './metadata_merge.js';
import {
  load_and_validate_sources,
  count_album_track_sources,
  MergeV2SourceError,
} from './validate_sources.js';
import { SCHEMA_VERSION_V2 } from './paths.js';

/**
 * @param {object} track_row
 */
function ensure_track_shape(track_row, spotify_id) {
  if (!track_row.spotify_id) {
    track_row.spotify_id = spotify_id;
  }
  if (!Array.isArray(track_row.appearances)) {
    track_row.appearances = [];
  }
  if (!Array.isArray(track_row.artists)) {
    track_row.artists = [];
  }
  if (!track_row.playability_status) {
    track_row.playability_status = playability_from_legacy(track_row);
  }
  if (
    !Array.isArray(track_row.artist_details) &&
    track_row.artists.length
  ) {
    track_row.artist_details = artist_details_from_any(track_row.artists);
  }
}

/**
 * @param {Record<string, object>} index_v1
 */
function clone_v1_index(index_v1) {
  /** @type {Record<string, object>} */
  const out = {};
  const ids = Object.keys(index_v1);
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const src = index_v1[id];
    const row = JSON.parse(JSON.stringify(src));
    row.appearances = clone_appearances(src.appearances);
    ensure_track_shape(row, id);
    out[id] = row;
  }
  return out;
}

/**
 * 驗證 v1 索引與 appearances 完整保留
 * @param {Record<string, object>} index_v1
 * @param {Record<string, object>} index_v2
 */
export function verify_v1_preserved(index_v1, index_v2) {
  const ids = Object.keys(index_v1);
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (!index_v2[id]) {
      throw new MergeV2SourceError(`V2 遺失 v1 歌曲 ID：${id}`);
    }
    const a1 = index_v1[id].appearances || [];
    const a2 = index_v2[id].appearances || [];
    if (a1.length > a2.length) {
      throw new MergeV2SourceError(
        `V2 遺失 v1 appearances：${id}（${a1.length} -> ${a2.length}）`
      );
    }
    for (let j = 0; j < a1.length; j += 1) {
      const fp1 = JSON.stringify(a1[j]);
      let found = false;
      for (let k = 0; k < a2.length; k += 1) {
        if (JSON.stringify(a2[k]) === fp1) {
          found = true;
          break;
        }
      }
      if (!found) {
        throw new MergeV2SourceError(
          `V2 遺失 v1 appearance：${id} index ${j}`
        );
      }
    }
  }
}

/**
 * @param {object} sources
 */
export function build_library_v2_from_sources(sources) {
  const {
    library_v1,
    merge_summary_v1,
    saved_albums_doc,
    album_tracks_doc,
    library_summary,
    followed_artists_doc,
    followed_summary,
  } = sources;

  const album_counts = count_album_track_sources(
    album_tracks_doc,
    saved_albums_doc
  );

  const expected_album_entries =
    library_summary.counts &&
    typeof library_summary.counts.total_track_entries === 'number'
      ? library_summary.counts.total_track_entries
      : null;

  if (
    expected_album_entries != null &&
    album_counts.track_rows !== expected_album_entries
  ) {
    throw new MergeV2SourceError(
      '專輯曲目筆數與 library-summary 不一致，停止合併 V2。',
      [
        `album-tracks=${album_counts.track_rows}`,
        `summary=${expected_album_entries}`,
      ]
    );
  }

  const index_v1 = library_v1.track_index_by_spotify_id;
  if (!index_v1 || typeof index_v1 !== 'object' || Array.isArray(index_v1)) {
    throw new MergeV2SourceError(
      'library.json 的 track_index_by_spotify_id 必須為物件。'
    );
  }
  const v1_ids = Object.keys(index_v1);
  const index_v2 = clone_v1_index(index_v1);

  /** @type {object[]} */
  const metadata_conflicts = [];
  let album_appearances_added = 0;
  let album_tracks_processed = 0;
  let album_tracks_missing_id = 0;

  const sections = album_tracks_doc.albums || [];
  for (let s = 0; s < sections.length; s += 1) {
    const sec = sections[s];
    if (!sec || sec.read_status !== 'ok') {
      continue;
    }
    const album_id = sec.album_id;
    const album_name = sec.album_name || null;
    const tracks = Array.isArray(sec.tracks) ? sec.tracks : [];

    for (let t = 0; t < tracks.length; t += 1) {
      album_tracks_processed += 1;
      const tr = tracks[t];
      const track_id = tr && tr.spotify_id ? tr.spotify_id : null;
      if (!track_id) {
        album_tracks_missing_id += 1;
        continue;
      }

      if (!index_v2[track_id]) {
        index_v2[track_id] = {
          spotify_id: track_id,
          uri: tr.uri || `spotify:track:${track_id}`,
          name: tr.name != null ? tr.name : null,
          artists: [],
          artist_details: [],
          album_name: null,
          album_id: null,
          release_date: null,
          duration_ms: tr.duration_ms != null ? tr.duration_ms : null,
          playability_status: tr.playability_status || 'unknown',
          appearances: [],
        };
        ensure_track_shape(index_v2[track_id], track_id);
      }

      const appearance = {
        kind: 'saved_album',
        source: tr.source || 'saved_album',
        backup_type: 'library_backup',
        album_id,
        album_name,
        position: typeof tr.position === 'number' ? tr.position : t,
        disc_number:
          typeof tr.disc_number === 'number' ? tr.disc_number : null,
        track_number:
          typeof tr.track_number === 'number' ? tr.track_number : null,
      };

      const added = push_appearance_unique(
        index_v2[track_id].appearances,
        appearance
      );
      if (added) {
        album_appearances_added += 1;
      }

      merge_track_metadata(
        index_v2[track_id],
        tr,
        'saved_album',
        metadata_conflicts
      );
    }
  }

  verify_v1_preserved(index_v1, index_v2);

  const v1_id_set = new Set(v1_ids);
  const v2_ids = Object.keys(index_v2);
  let new_track_ids_from_albums = 0;
  for (let i = 0; i < v2_ids.length; i += 1) {
    if (!v1_id_set.has(v2_ids[i])) {
      new_track_ids_from_albums += 1;
    }
  }

  let appearances_total = 0;
  for (let i = 0; i < v2_ids.length; i += 1) {
    const apps = index_v2[v2_ids[i]].appearances || [];
    appearances_total += apps.length;
  }

  const playlist_total =
    merge_summary_v1.counts &&
    merge_summary_v1.counts.playlist_track_entries_total != null
      ? merge_summary_v1.counts.playlist_track_entries_total
      : (library_v1.playlist_track_entries || []).length;

  const liked_total =
    merge_summary_v1.counts &&
    merge_summary_v1.counts.liked_tracks != null
      ? merge_summary_v1.counts.liked_tracks
      : (library_v1.liked_tracks || []).length;

  const source_occurrences_total =
    playlist_total + liked_total + album_counts.track_rows;

  const meta_stats = compute_metadata_stats(index_v2);
  meta_stats.metadata_conflicts = metadata_conflicts.length;
  meta_stats.metadata_missing_or_conflict =
    metadata_conflicts.length + meta_stats.id_only;

  const saved_albums = (saved_albums_doc.albums || []).map(function (a) {
    return {
      album_id: a.album_id,
      uri: a.uri,
      name: a.name,
      album_type: a.album_type,
      artists: a.artists || [],
      added_at: a.added_at || null,
      release_date: a.release_date || null,
      total_tracks: a.total_tracks,
      tracks_read_status: a.tracks_read_status,
      tracks_fetched_count: a.tracks_fetched_count,
      tracks_api_total: a.tracks_api_total,
      position: a.position,
    };
  });

  const followed_artists = (followed_artists_doc.artists || []).slice();

  const merged_at = new Date().toISOString();

  const library_v2_doc = {
    schema_version: SCHEMA_VERSION_V2,
    merged_at,
    user_id: library_v1.user_id || saved_albums_doc.user_id || null,
    source_refs: {
      library_v1: 'backup/merged/library.json',
      merge_summary_v1: 'backup/merged/merge-summary.json',
      saved_albums: 'backup/library/saved-albums.json',
      album_tracks: 'backup/library/album-tracks.json',
      followed_artists: 'backup/library/followed-artists.json',
    },
    playlist_track_entries: library_v1.playlist_track_entries || [],
    liked_tracks: library_v1.liked_tracks || [],
    saved_albums,
    followed_artists,
    track_index_by_spotify_id: index_v2,
  };

  const v1_unique_preserved = v1_ids.every(function (id) {
    return Boolean(index_v2[id]);
  });

  const album_tracks_fully_integrated =
    album_tracks_processed === album_counts.track_rows &&
    album_tracks_missing_id === 0;

  const library_v2_merge_complete =
    v1_unique_preserved &&
    album_tracks_fully_integrated &&
    metadata_conflicts.length >= 0;

  const merge_summary_v2 = {
    schema_version: SCHEMA_VERSION_V2,
    merged_at,
    library_v2_merge_complete,
    counts: {
      playlist_track_entries: playlist_total,
      liked_tracks: liked_total,
      saved_album_track_entries: album_counts.track_rows,
      source_occurrences_total,
      unique_tracks_by_spotify_id: v2_ids.length,
      unique_tracks_v1: v1_ids.length,
      new_unique_track_ids_from_albums: new_track_ids_from_albums,
      appearances_total,
      album_appearances_added,
      saved_albums: saved_albums.length,
      followed_artists: followed_artists.length,
    },
    v1_preservation: {
      all_v1_track_ids_in_v2: v1_unique_preserved,
      v1_track_id_count: v1_ids.length,
      appearances_preserved_from_v1: true,
    },
    album_integration: {
      album_tracks_processed,
      album_tracks_expected: album_counts.track_rows,
      album_tracks_missing_id,
      album_sections: album_counts.album_sections,
    },
    metadata: meta_stats,
    metadata_conflicts,
    followed_artists_backup_complete:
      followed_summary.followed_artists_backup_complete === true,
    library_albums_backup_complete:
      library_summary.library_albums_backup_complete === true,
    library_data_complete_v1: merge_summary_v1.library_data_complete === true,
  };

  if (!library_v2_merge_complete) {
    throw new MergeV2SourceError(
      '完整性驗證未通過，拒絕發布 library-v2。',
      [
        `v1_preserved=${v1_unique_preserved}`,
        `album_full=${album_tracks_fully_integrated}`,
      ]
    );
  }

  return {
    library_v2_doc,
    merge_summary_v2,
  };
}

/**
 * 載入來源並建構 V2
 */
export function run_build_library_v2() {
  const sources = load_and_validate_sources();
  return build_library_v2_from_sources(sources);
}
