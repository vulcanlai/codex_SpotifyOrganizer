/**
 * 收藏專輯與曲目正規化（依 API 實際欄位，缺則 null / unknown）
 */

/**
 * @param {unknown} artists_raw
 * @returns {{ id: string|null, name: string|null }[]}
 */
export function map_artists(artists_raw) {
  if (!Array.isArray(artists_raw)) {
    return [];
  }
  const out = [];
  for (let i = 0; i < artists_raw.length; i += 1) {
    const a = artists_raw[i];
    if (!a || typeof a !== 'object') {
      continue;
    }
    out.push({
      id: typeof a.id === 'string' ? a.id : null,
      name: typeof a.name === 'string' ? a.name : null,
    });
  }
  return out;
}

/**
 * @param {object|null} track
 */
export function playability_status_from_track(track) {
  if (!track || typeof track !== 'object') {
    return 'unknown';
  }
  if (track.is_local === true) {
    return 'local';
  }
  if (track.restrictions && track.restrictions.reason) {
    return 'not_playable';
  }
  if (typeof track.is_playable === 'boolean') {
    return track.is_playable ? 'playable' : 'not_playable';
  }
  return 'unknown';
}

/**
 * @param {object} saved_row - GET /me/albums item
 * @param {number} position - 收藏清單順序（0 起算）
 */
export function normalize_saved_album_row(saved_row, position) {
  const album = saved_row && saved_row.album ? saved_row.album : null;
  if (!album) {
    return {
      position,
      album_id: null,
      uri: null,
      name: null,
      album_type: null,
      artists: [],
      added_at:
        saved_row && typeof saved_row.added_at === 'string'
          ? saved_row.added_at
          : null,
      release_date: null,
      total_tracks: null,
      tracks_read_status: 'failed',
      tracks_read_error: { message: '缺少 album 物件' },
      tracks_fetched_count: 0,
      tracks_api_total: null,
    };
  }

  return {
    position,
    album_id: typeof album.id === 'string' ? album.id : null,
    uri: typeof album.uri === 'string' ? album.uri : null,
    name: typeof album.name === 'string' ? album.name : null,
    album_type: typeof album.album_type === 'string' ? album.album_type : null,
    artists: map_artists(album.artists),
    added_at:
      saved_row && typeof saved_row.added_at === 'string'
        ? saved_row.added_at
        : null,
    release_date:
      typeof album.release_date === 'string' ? album.release_date : null,
    total_tracks:
      typeof album.total_tracks === 'number' ? album.total_tracks : null,
    tracks_read_status: 'pending',
    tracks_read_error: null,
    tracks_fetched_count: 0,
    tracks_api_total: null,
  };
}

/**
 * @param {object} track - SimplifiedTrackObject
 * @param {object} ctx
 */
export function normalize_album_track(track, ctx) {
  const album_id = ctx.album_id || null;
  return {
    position: ctx.position,
    disc_number: typeof track.disc_number === 'number' ? track.disc_number : null,
    track_number:
      typeof track.track_number === 'number' ? track.track_number : null,
    spotify_id: typeof track.id === 'string' ? track.id : null,
    uri: typeof track.uri === 'string' ? track.uri : null,
    name: typeof track.name === 'string' ? track.name : null,
    artists: map_artists(track.artists),
    album_id,
    duration_ms:
      typeof track.duration_ms === 'number' ? track.duration_ms : null,
    is_playable:
      typeof track.is_playable === 'boolean' ? track.is_playable : null,
    restrictions:
      track.restrictions && typeof track.restrictions === 'object'
        ? { reason: track.restrictions.reason || null }
        : null,
    is_local: track.is_local === true,
    playability_status: playability_status_from_track(track),
    source: 'saved_album',
  };
}
