/**
 * 分類索引搜尋與篩選（記憶體內）
 */

function normalize_query(q) {
  return String(q || '')
    .trim()
    .toLowerCase();
}

/**
 * @param {object} index_doc
 * @param {object} filters
 */
export function search_classification_tracks(index_doc, filters) {
  const f = filters || {};
  const q = normalize_query(f.q);
  const decade = f.decade || '';
  const language = f.language || '';
  const genre = f.genre || '';
  const primary_genre = f.primary_genre || '';
  const subgenre = f.subgenre || '';
  const context = f.context || '';
  const limit = typeof f.limit === 'number' && f.limit > 0 ? f.limit : 50;
  const offset = typeof f.offset === 'number' && f.offset >= 0 ? f.offset : 0;

  const tracks = index_doc && index_doc.tracks_by_id ? index_doc.tracks_by_id : {};
  const ids = Object.keys(tracks).sort();
  /** @type {object[]} */
  const matched = [];

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const row = tracks[id];
    if (
      !match_filters(row, q, decade, language, genre, primary_genre, subgenre, context)
    ) {
      continue;
    }
    matched.push(summarize_track_row(row));
  }

  return {
    total: matched.length,
    offset,
    limit,
    items: matched.slice(offset, offset + limit),
  };
}

function match_filters(
  row,
  q,
  decade,
  language,
  genre,
  primary_genre,
  subgenre,
  context
) {
  if (decade && !has_tag(row, 'decade', decade)) {
    return false;
  }
  if (language && !has_tag(row, 'language', language)) {
    return false;
  }
  if (genre && !has_tag(row, 'genre', genre)) {
    return false;
  }
  if (primary_genre) {
    const gp = row.genre_profile || {};
    if ((gp.primary_genre || 'unknown') !== primary_genre) {
      return false;
    }
  }
  if (subgenre) {
    const subs = (row.genre_profile || {}).subgenres || [];
    if (subs.indexOf(subgenre) < 0) {
      return false;
    }
  }
  if (context && !has_tag(row, 'context', context)) {
    return false;
  }
  if (!q) {
    return true;
  }
  if (String(row.spotify_id).toLowerCase().indexOf(q) >= 0) {
    return true;
  }
  const disp = row.display || {};
  if (disp.name && String(disp.name).toLowerCase().indexOf(q) >= 0) {
    return true;
  }
  const artists = disp.artists || [];
  for (let a = 0; a < artists.length; a += 1) {
    if (String(artists[a]).toLowerCase().indexOf(q) >= 0) {
      return true;
    }
  }
  return false;
}

function has_tag(row, dimension, value) {
  const tags = row.tags || [];
  for (let i = 0; i < tags.length; i += 1) {
    if (tags[i].dimension === dimension && tags[i].value === value) {
      return true;
    }
  }
  return false;
}

function summarize_track_row(row) {
  return {
    spotify_id: row.spotify_id,
    metadata_status: row.metadata_status,
    display: row.display,
    tags: row.tags,
    genre_profile: row.genre_profile,
  };
}

/**
 * @param {object} index_doc
 * @param {string} track_id
 */
export function get_classification_track(index_doc, track_id) {
  const tracks = index_doc && index_doc.tracks_by_id ? index_doc.tracks_by_id : {};
  return tracks[track_id] || null;
}
