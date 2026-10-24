/**
 * 本機藝人名稱變體（僅來自已備份資料，不臆造別名）
 */
import { load_index_tracks, load_metadata_cache } from './track_input.js';

function norm_key(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function has_cjk(s) {
  return /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(String(s || ''));
}

let spotify_artist_id_index = null;

/**
 * 依 Spotify Artist ID 彙整 enrichment / index 已出現的藝人名
 */
function build_spotify_artist_id_index() {
  if (spotify_artist_id_index) {
    return spotify_artist_id_index;
  }
  /** @type {Record<string, { names: string[], sources: string[] }>} */
  const by_id = {};
  function add_id(id, name, source) {
    const aid = String(id || '').trim();
    const n = String(name || '').trim();
    if (!aid || !n) {
      return;
    }
    if (!by_id[aid]) {
      by_id[aid] = { names: [], sources: [] };
    }
    const bucket = by_id[aid];
    const k = norm_key(n);
    let found = false;
    for (let i = 0; i < bucket.names.length; i += 1) {
      if (norm_key(bucket.names[i]) === k) {
        found = true;
        break;
      }
    }
    if (!found) {
      bucket.names.push(n);
      bucket.sources.push(source);
    }
  }

  const cache = load_metadata_cache();
  const cache_ids = Object.keys(cache);
  for (let c = 0; c < cache_ids.length; c += 1) {
    const row = cache[cache_ids[c]];
    const artists = row && row.artists ? row.artists : [];
    for (let a = 0; a < artists.length; a += 1) {
      if (artists[a] && artists[a].id && artists[a].name) {
        add_id(artists[a].id, artists[a].name, 'enrichment_cache.artists');
      }
    }
  }

  const tracks = load_index_tracks();
  const tids = Object.keys(tracks);
  for (let t = 0; t < tids.length; t += 1) {
    const tr = tracks[tids[t]];
    const details =
      tr && tr.merged_metadata && tr.merged_metadata.artist_details
        ? tr.merged_metadata.artist_details
        : [];
    for (let d = 0; d < details.length; d += 1) {
      if (details[d] && details[d].id && details[d].name) {
        add_id(
          details[d].id,
          details[d].name,
          'index.merged_metadata.artist_details'
        );
      }
    }
  }

  spotify_artist_id_index = by_id;
  return by_id;
}

export function reset_artist_variants_cache_for_tests() {
  spotify_artist_id_index = null;
}

/**
 * @param {string} spotify_id
 */
export function artist_name_variants_for_track(spotify_id) {
  const tracks = load_index_tracks();
  const row = tracks[spotify_id];
  if (!row) {
    return {
      names: [],
      search_artist: '',
      sources: [],
      spotify_artist_ids: [],
      evidence_sources: [],
    };
  }
  const seen = {};
  /** @type {string[]} */
  const names = [];
  /** @type {string[]} */
  const sources = [];
  /** @type {string[]} */
  const spotify_artist_ids = [];

  function add(name, source) {
    const t = String(name || '').trim();
    if (!t) {
      return;
    }
    const k = norm_key(t);
    if (seen[k]) {
      return;
    }
    seen[k] = true;
    names.push(t);
    sources.push(source);
  }

  function add_id(id) {
    const aid = String(id || '').trim();
    if (!aid || spotify_artist_ids.indexOf(aid) >= 0) {
      return;
    }
    spotify_artist_ids.push(aid);
  }

  const disp = row.display || {};
  const disp_artists = disp.artists || [];
  for (let i = 0; i < disp_artists.length; i += 1) {
    add(disp_artists[i], 'display.artists');
  }

  const merged = row.merged_metadata || {};
  const m_artists = merged.artists || [];
  for (let j = 0; j < m_artists.length; j += 1) {
    add(m_artists[j], 'merged_metadata.artists');
  }
  const details = merged.artist_details || [];
  for (let d = 0; d < details.length; d += 1) {
    if (details[d] && details[d].name) {
      add(details[d].name, 'merged_metadata.artist_details');
    }
    if (details[d] && details[d].id) {
      add_id(details[d].id);
    }
  }

  const meta = load_metadata_cache()[spotify_id] || {};
  const cache_artists = meta.artists || [];
  for (let c = 0; c < cache_artists.length; c += 1) {
    const a = cache_artists[c];
    if (a && a.name) {
      add(a.name, 'enrichment_cache.artists');
    }
    if (a && a.id) {
      add_id(a.id);
    }
  }

  const id_index = build_spotify_artist_id_index();
  for (let s = 0; s < spotify_artist_ids.length; s += 1) {
    const bucket = id_index[spotify_artist_ids[s]];
    if (!bucket) {
      continue;
    }
    for (let n = 0; n < bucket.names.length; n += 1) {
      add(bucket.names[n], 'spotify_artist_id:' + spotify_artist_ids[s]);
    }
  }

  let search_artist = '';
  for (let n = 0; n < names.length; n += 1) {
    if (has_cjk(names[n])) {
      search_artist = names[n];
      break;
    }
  }
  if (!search_artist && names.length) {
    search_artist = names[0];
  }

  return {
    names: names,
    search_artist: search_artist,
    sources: sources,
    spotify_artist_ids: spotify_artist_ids,
    evidence_sources: sources.slice(),
  };
}
