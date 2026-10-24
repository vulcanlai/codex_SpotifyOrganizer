/**
 * MusicBrainz 公開 API Provider（不呼叫 Spotify）
 * @see https://musicbrainz.org/doc/MusicBrainz_API
 */
import { mb_request, mb_fetch_json } from './mb_http.js';

const MB_BASE = 'https://musicbrainz.org/ws/2';

/**
 * @param {object} rec
 */
function artist_names_from_recording(rec) {
  const out = [];
  const ac = rec['artist-credit'] || [];
  for (let i = 0; i < ac.length; i += 1) {
    const item = ac[i];
    if (item && item.name) {
      out.push(String(item.name));
    } else if (item && item.artist && item.artist.name) {
      out.push(String(item.artist.name));
    }
  }
  return out;
}

/**
 * @param {object} rec
 */
function duration_from_recording(rec) {
  if (typeof rec.length === 'number') {
    return rec.length;
  }
  return null;
}

/**
 * @param {object} rec
 */
function tags_from_recording(rec) {
  const tags = rec.tags || [];
  const out = [];
  for (let i = 0; i < tags.length; i += 1) {
    if (tags[i] && tags[i].name) {
      out.push(String(tags[i].name));
    }
  }
  return out;
}

/**
 * @param {object} rec
 */
function first_release_date(rec) {
  const rels = rec.releases || [];
  if (rels.length && rels[0].date) {
    return String(rels[0].date);
  }
  return null;
}

/**
 * @param {object} rec
 * @returns {import('./provider_base.js').ExternalCandidate}
 */
function recording_to_candidate(rec) {
  const id = rec.id || '';
  return {
    provider: 'musicbrainz',
    entity_type: 'recording',
    external_id: id,
    title: rec.title || '',
    artist_names: artist_names_from_recording(rec),
    duration_ms: duration_from_recording(rec),
    first_release_date: first_release_date(rec),
    tags: tags_from_recording(rec),
    source_url: id ? 'https://musicbrainz.org/recording/' + id : '',
    match_score: 0,
    match_reasons: [],
  };
}

function escape_lucene(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[+\-&|!(){}[\]^~*?:]/g, '\\$&');
}

function has_cjk(s) {
  return /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(String(s || ''));
}

/**
 * G2.1：備援搜尋 — 有 CJK 藝人名才 AND artist；否則僅歌名（本機再嚴格比對）
 * @param {import('./provider_base.js').ExternalTrackInput} input
 * @param {{ search_artist?: string, search_mode?: string }} [opts]
 */
export function build_recording_search_query(input, opts) {
  const options = opts || {};
  const title = escape_lucene(input.title);
  let q = 'recording:"' + title + '"';
  if (options.search_mode === 'title_only') {
    return q;
  }
  let artist_raw = options.search_artist;
  if (!artist_raw) {
    artist_raw = input.artists && input.artists[0] ? input.artists[0] : '';
  }
  if (artist_raw && has_cjk(artist_raw)) {
    q += ' AND artist:"' + escape_lucene(artist_raw) + '"';
  }
  return q;
}

export const musicbrainz_provider = {
  id: 'musicbrainz',

  /**
   * @param {typeof fetch} fetch_fn
   * @param {string} isrc
   */
  async lookup_by_isrc(fetch_fn, isrc) {
    const safe = await musicbrainz_provider.lookup_by_isrc_safe(fetch_fn, isrc);
    if (safe.outcome === 'retryable_error') {
      throw safe.error;
    }
    return {
      ok: safe.outcome === 'found',
      query_key: safe.query_key,
      candidates: safe.candidates,
      raw: safe.raw,
    };
  },

  /**
   * G2：404 為查無，不拋例外
   * @param {typeof fetch} fetch_fn
   * @param {string} isrc
   */
  async lookup_by_isrc_safe(fetch_fn, isrc) {
    const code = String(isrc || '').trim().toUpperCase();
    if (!code) {
      return {
        outcome: 'not_found',
        query_key: '',
        candidates: [],
        raw: null,
        http_status: null,
      };
    }
    const url =
      MB_BASE + '/isrc/' + encodeURIComponent(code) + '?inc=artists+releases+tags&fmt=json';
    const http = await mb_fetch_json(fetch_fn, url);
    if (http.not_found) {
      return {
        outcome: 'not_found',
        query_key: 'isrc:' + code,
        candidates: [],
        raw: null,
        http_status: 404,
      };
    }
    const data = http.data || {};
    const recordings = data.recordings || [];
    const candidates = [];
    for (let i = 0; i < recordings.length; i += 1) {
      candidates.push(recording_to_candidate(recordings[i]));
    }
    if (!candidates.length) {
      return {
        outcome: 'not_found',
        query_key: 'isrc:' + code,
        candidates: [],
        raw: data,
        http_status: http.http_status,
      };
    }
    return {
      outcome: 'found',
      query_key: 'isrc:' + code,
      candidates: candidates,
      raw: data,
      http_status: http.http_status,
    };
  },

  /**
   * @param {typeof fetch} fetch_fn
   * @param {import('./provider_base.js').ExternalTrackInput} input
   * @param {{ search_artist?: string }} [opts]
   */
  async search_recording(fetch_fn, input, opts) {
    const options = opts || {};
    const title = escape_lucene(input.title);
    const q = build_recording_search_query(input, options);
    const url =
      MB_BASE +
      '/recording/?query=' +
      encodeURIComponent(q) +
      '&limit=' +
      (options.limit || 25) +
      '&inc=artist-credits+releases+tags&fmt=json';
    const data = await mb_request(fetch_fn, url);
    const recs = data.recordings || [];
    const candidates = [];
    for (let i = 0; i < recs.length; i += 1) {
      candidates.push(recording_to_candidate(recs[i]));
    }
    return {
      ok: true,
      query_key: 'search:' + q,
      candidates,
      raw: data,
    };
  },
};
