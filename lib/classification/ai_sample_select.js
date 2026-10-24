/**
 * AI 測試樣本：可重現的固定選取
 */
import { DIMENSION_DECADE } from './dimensions.js';

/**
 * @param {object} track_row
 */
export function primary_artist_name(track_row) {
  const disp = track_row.display || {};
  const artists = disp.artists || [];
  if (artists.length && artists[0]) {
    return String(artists[0]).trim().toLowerCase();
  }
  const details = track_row.merged_metadata?.artist_details || [];
  if (details.length && details[0] && details[0].name) {
    return String(details[0].name).trim().toLowerCase();
  }
  return '';
}

/**
 * @param {object} track_row
 */
export function decade_from_tags(track_row) {
  const tags = track_row.tags || [];
  for (let i = 0; i < tags.length; i += 1) {
    if (tags[i].dimension === DIMENSION_DECADE) {
      return tags[i].value || '年代未知';
    }
  }
  return '年代未知';
}

/**
 * @param {object} track_row
 */
export function album_key(track_row) {
  const d = track_row.display || {};
  const name = d.album_name || track_row.merged_metadata?.album_name || '';
  const id = track_row.merged_metadata?.album_id || '';
  return (id || name || 'unknown').toLowerCase();
}

/**
 * @param {object} track_row
 */
export function is_eligible_for_ai_sample(track_row) {
  if (!track_row || !track_row.spotify_id) {
    return false;
  }
  if (track_row.metadata_status !== 'complete') {
    return false;
  }
  const disp = track_row.display || {};
  if (!disp.name || !String(disp.name).trim()) {
    return false;
  }
  const artists = disp.artists || [];
  if (!artists.length || !String(artists[0]).trim()) {
    return false;
  }
  return true;
}

/**
 * @param {Record<string, object>} tracks_by_id
 * @param {number} count
 */
/**
 * @param {Record<string, object>} tracks_by_id
 * @param {number} count
 * @param {{ exclude_ids?: string[] }} [opts]
 */
export function select_ai_sample_track_ids(tracks_by_id, count, opts) {
  const options = opts || {};
  const exclude = {};
  const ex = options.exclude_ids || [];
  for (let x = 0; x < ex.length; x += 1) {
    exclude[ex[x]] = true;
  }
  const target = typeof count === 'number' && count > 0 ? count : 30;
  const ids = Object.keys(tracks_by_id || {}).sort();
  /** @type {string[]} */
  const eligible = [];
  for (let i = 0; i < ids.length; i += 1) {
    if (exclude[ids[i]]) {
      continue;
    }
    if (is_eligible_for_ai_sample(tracks_by_id[ids[i]])) {
      eligible.push(ids[i]);
    }
  }

  if (eligible.length < target) {
    return {
      ok: false,
      eligible_count: eligible.length,
      requested: target,
      selected_ids: [],
      reason: `有效歌曲僅 ${eligible.length} 首，不足 ${target} 首。`,
    };
  }

  /** @type {Record<string, string[]>} */
  const by_decade = {};
  for (let e = 0; e < eligible.length; e += 1) {
    const id = eligible[e];
    const decade = decade_from_tags(tracks_by_id[id]);
    if (!by_decade[decade]) {
      by_decade[decade] = [];
    }
    by_decade[decade].push(id);
  }
  const decades = Object.keys(by_decade).sort();
  for (let d = 0; d < decades.length; d += 1) {
    by_decade[decades[d]].sort();
  }

  /** @type {string[]} */
  const selected = [];
  const used_artists = {};
  const used_albums = {};

  function try_pick(id) {
    if (selected.indexOf(id) >= 0) {
      return false;
    }
    const row = tracks_by_id[id];
    const artist = primary_artist_name(row);
    const album = album_key(row);
    if (used_artists[artist] >= 2) {
      return false;
    }
    selected.push(id);
    used_artists[artist] = (used_artists[artist] || 0) + 1;
    used_albums[album] = (used_albums[album] || 0) + 1;
    return true;
  }

  let round = 0;
  while (selected.length < target && round < 500) {
    round += 1;
    let added = false;
    for (let di = 0; di < decades.length; di += 1) {
      if (selected.length >= target) {
        break;
      }
      const pool = by_decade[decades[di]];
      for (let pi = 0; pi < pool.length; pi += 1) {
        const id = pool[pi];
        if (selected.indexOf(id) >= 0) {
          continue;
        }
        const artist = primary_artist_name(tracks_by_id[id]);
        if (round === 1 && used_artists[artist]) {
          continue;
        }
        if (try_pick(id)) {
          added = true;
          break;
        }
      }
    }
    if (!added) {
      for (let fi = 0; fi < eligible.length && selected.length < target; fi += 1) {
        try_pick(eligible[fi]);
      }
      break;
    }
  }

  selected.sort();
  return {
    ok: selected.length === target,
    eligible_count: eligible.length,
    requested: target,
    selected_ids: selected.slice(0, target),
    reason:
      selected.length === target
        ? null
        : `僅選出 ${selected.length} 首（目標 ${target}）。`,
  };
}
