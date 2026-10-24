/**
 * 合併 library-v2 與 enrichment 快取（唯讀來源，不寫回）
 */
import {
  merge_track_metadata,
  is_weak_metadata_value,
  artist_names_from_any,
} from '../merge/v2/metadata_merge.js';
import { is_metadata_cache_complete } from '../enrichment/track_entry.js';
import { cache_entry_trusted_for_merge } from '../enrichment/metadata_cache_guard.js';

/**
 * @param {object|null} cache_entry
 */
export function cache_entry_to_incoming_meta(cache_entry, track_id) {
  const id = track_id || (cache_entry && cache_entry.spotify_id);
  if (!cache_entry || !id) {
    return null;
  }
  if (!cache_entry_trusted_for_merge(id, cache_entry)) {
    return null;
  }
  const album = cache_entry.album;
  const meta = {
    name: cache_entry.name,
    artists: cache_entry.artists,
    album_name: album && album.name ? album.name : null,
    album_id: album && album.id ? album.id : null,
    release_date: album && album.release_date ? album.release_date : null,
    release_date_precision:
      album && album.release_date_precision
        ? album.release_date_precision
        : null,
    duration_ms: cache_entry.duration_ms,
    uri: cache_entry.uri,
    playability_status: cache_entry.playability_status,
  };
  return meta;
}

/**
 * @param {object} v2_row
 * @param {object|null} cache_entry
 */
export function build_merged_track_record(v2_row, cache_entry) {
  const row = JSON.parse(JSON.stringify(v2_row || {}));
  row.spotify_id = row.spotify_id || (cache_entry && cache_entry.spotify_id);
  const conflicts = [];
  const incoming = cache_entry_to_incoming_meta(cache_entry, row.spotify_id);
  if (incoming) {
    merge_track_metadata(row, incoming, 'enrichment:track-metadata-cache', conflicts);
  }
  if (incoming && incoming.release_date_precision && !row.release_date_precision) {
    row.release_date_precision = incoming.release_date_precision;
  }
  const has_name = !is_weak_metadata_value(row.name);
  const artist_list = artist_names_from_any(
    row.artist_details && row.artist_details.length
      ? row.artist_details
      : row.artists
  );
  const has_artists = artist_list.length > 0;
  const metadata_complete = has_name && has_artists;
  const enrichment_complete =
    cache_entry &&
    cache_entry_trusted_for_merge(row.spotify_id, cache_entry) &&
    is_metadata_cache_complete(cache_entry) === true;

  return {
    spotify_id: row.spotify_id,
    metadata_status: metadata_complete ? 'complete' : 'metadata_missing',
    enrichment_cache_complete: enrichment_complete,
    display: {
      name: has_name ? row.name : null,
      artists: has_artists ? artist_list : [],
      album_name: is_weak_metadata_value(row.album_name)
        ? cache_entry && cache_entry.album
          ? cache_entry.album.name
          : null
        : row.album_name,
      release_date: is_weak_metadata_value(row.release_date)
        ? null
        : row.release_date,
      release_date_precision: row.release_date_precision || null,
    },
    merged_metadata: {
      name: row.name,
      artists: row.artists,
      artist_details: row.artist_details,
      album_name: row.album_name,
      album_id: row.album_id,
      release_date: row.release_date,
      release_date_precision: row.release_date_precision || null,
      duration_ms: row.duration_ms,
      uri: row.uri,
      playability_status: row.playability_status,
    },
    metadata_conflicts: conflicts,
    appearances: Array.isArray(row.appearances) ? row.appearances : [],
  };
}
