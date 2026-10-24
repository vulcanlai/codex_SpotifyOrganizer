/**
 * 歌曲 metadata 互補合併與衝突記錄（不用 null/unknown 覆蓋有效值）
 */

/**
 * @param {unknown} value
 */
export function is_weak_metadata_value(value) {
  if (value == null) {
    return true;
  }
  if (value === 'unknown') {
    return true;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  return false;
}

/**
 * @param {unknown} artists
 * @returns {string[]}
 */
export function artist_names_from_any(artists) {
  if (!Array.isArray(artists)) {
    return [];
  }
  const names = [];
  for (let i = 0; i < artists.length; i += 1) {
    const a = artists[i];
    if (typeof a === 'string' && a) {
      names.push(a);
    } else if (a && typeof a === 'object' && typeof a.name === 'string' && a.name) {
      names.push(a.name);
    }
  }
  return names;
}

/**
 * @param {unknown} artists
 * @returns {{ id: string|null, name: string|null }[]}
 */
export function artist_details_from_any(artists) {
  if (!Array.isArray(artists)) {
    return [];
  }
  const out = [];
  for (let i = 0; i < artists.length; i += 1) {
    const a = artists[i];
    if (typeof a === 'string') {
      out.push({ id: null, name: a || null });
    } else if (a && typeof a === 'object') {
      out.push({
        id: typeof a.id === 'string' ? a.id : null,
        name: typeof a.name === 'string' ? a.name : null,
      });
    }
  }
  return out;
}

/**
 * @param {string[]} existing
 * @param {string[]} incoming
 */
function merge_name_list(existing, incoming) {
  const out = existing.slice();
  for (let i = 0; i < incoming.length; i += 1) {
    const n = incoming[i];
    if (n && out.indexOf(n) < 0) {
      out.push(n);
    }
  }
  return out;
}

/**
 * @param {{ id: string|null, name: string|null }[]} existing
 * @param {{ id: string|null, name: string|null }[]} incoming
 */
function merge_artist_details(existing, incoming) {
  const out = existing.slice();
  for (let i = 0; i < incoming.length; i += 1) {
    const inc = incoming[i];
    let found = false;
    for (let j = 0; j < out.length; j += 1) {
      const ex = out[j];
      if (inc.id && ex.id === inc.id) {
        found = true;
        if (!ex.name && inc.name) {
          out[j] = { id: ex.id, name: inc.name };
        }
        break;
      }
      if (!inc.id && inc.name && ex.name === inc.name) {
        found = true;
        break;
      }
    }
    if (!found) {
      out.push(inc);
    }
  }
  return out;
}

/**
 * @param {object} track_row - index 內的歌曲列
 * @param {object} incoming_meta
 * @param {string} incoming_source_label
 * @param {object[]} conflicts_out
 */
export function merge_track_metadata(track_row, incoming_meta, incoming_source_label, conflicts_out) {
  const fields = [
    'name',
    'album_name',
    'album_id',
    'release_date',
    'duration_ms',
    'uri',
  ];

  for (let f = 0; f < fields.length; f += 1) {
    const key = fields[f];
    const cur = track_row[key];
    const inc = incoming_meta[key];
    if (is_weak_metadata_value(inc)) {
      continue;
    }
    if (is_weak_metadata_value(cur)) {
      track_row[key] = inc;
      continue;
    }
    if (cur !== inc) {
      conflicts_out.push({
        spotify_id: track_row.spotify_id,
        field: key,
        existing: cur,
        incoming: inc,
        incoming_source: incoming_source_label,
      });
    }
  }

  const inc_names = artist_names_from_any(incoming_meta.artists);
  if (inc_names.length) {
    const cur_names = Array.isArray(track_row.artists) ? track_row.artists : [];
    if (!cur_names.length) {
      track_row.artists = inc_names;
    } else {
      track_row.artists = merge_name_list(cur_names, inc_names);
    }
  }

  const inc_details = artist_details_from_any(incoming_meta.artists);
  if (inc_details.length) {
    const cur_details = Array.isArray(track_row.artist_details)
      ? track_row.artist_details
      : artist_details_from_any(track_row.artists);
    track_row.artist_details = merge_artist_details(cur_details, inc_details);
  }

  const inc_play =
    incoming_meta.playability_status ||
    playability_from_legacy(incoming_meta);
  const cur_play = track_row.playability_status;
  if (inc_play && inc_play !== 'unknown') {
    if (!cur_play || cur_play === 'unknown') {
      track_row.playability_status = inc_play;
    } else if (cur_play !== inc_play) {
      conflicts_out.push({
        spotify_id: track_row.spotify_id,
        field: 'playability_status',
        existing: cur_play,
        incoming: inc_play,
        incoming_source: incoming_source_label,
      });
    }
  }
}

/**
 * @param {object} meta
 */
export function playability_from_legacy(meta) {
  if (meta.playability_status) {
    return meta.playability_status;
  }
  if (typeof meta.is_playable === 'boolean') {
    return meta.is_playable ? 'playable' : 'not_playable';
  }
  return 'unknown';
}

/**
 * @param {Record<string, object>} track_index
 */
export function compute_metadata_stats(track_index) {
  const ids = Object.keys(track_index);
  let with_name = 0;
  let with_artists = 0;
  let with_release_date = 0;
  let id_only = 0;
  let playability_unknown = 0;

  for (let i = 0; i < ids.length; i += 1) {
    const tr = track_index[ids[i]];
    const has_name = !is_weak_metadata_value(tr.name);
    const has_artists =
      (Array.isArray(tr.artists) && tr.artists.length > 0) ||
      (Array.isArray(tr.artist_details) &&
        tr.artist_details.some(function (a) {
          return a && (a.name || a.id);
        }));
    const has_release = !is_weak_metadata_value(tr.release_date);
    const has_only_id =
      tr.spotify_id &&
      !has_name &&
      !has_artists &&
      is_weak_metadata_value(tr.album_name) &&
      is_weak_metadata_value(tr.release_date);

    if (has_name) {
      with_name += 1;
    }
    if (has_artists) {
      with_artists += 1;
    }
    if (has_release) {
      with_release_date += 1;
    }
    if (has_only_id) {
      id_only += 1;
    }
    const ps = tr.playability_status || playability_from_legacy(tr);
    if (!ps || ps === 'unknown') {
      playability_unknown += 1;
    }
  }

  return {
    unique_tracks: ids.length,
    with_name,
    with_artists,
    with_release_date,
    id_only,
    playability_unknown,
  };
}
