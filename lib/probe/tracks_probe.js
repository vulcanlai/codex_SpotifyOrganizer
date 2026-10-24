/**
 * GET /v1/tracks/{id} 小規模唯讀探測（不寫入 backup）
 */
import { fetch_track_catalog, SpotifyRequestError } from '../spotify_api.js';
import { spotify_error_summary } from './albums_probe.js';
import {
  select_id_only_tracks_from_index,
  load_library_v2_for_probe,
} from './library_v2_select.js';

export const PROBE_TRACKS_MAX = 10;

/** probe 用 429：最多 1 次重試，Retry-After 最長 60 秒 */
export const PROBE_SPOTIFY_GET_OPTS = {
  max_rate_retries: 1,
  max_retry_after_sec: 60,
  rate_limit_source: 'probe:tracks',
};

/**
 * @param {unknown} body
 */
export function parse_track_catalog_response(body) {
  const tr = body && typeof body === 'object' ? body : null;
  if (!tr) {
    return {
      parsed: false,
      message: '回應不是物件',
    };
  }

  const album = tr.album && typeof tr.album === 'object' ? tr.album : null;
  /** @type {object[]} */
  const artists = [];
  if (Array.isArray(tr.artists)) {
    for (let i = 0; i < tr.artists.length; i += 1) {
      const a = tr.artists[i];
      artists.push({
        id: a && a.id ? a.id : null,
        name: a && a.name ? a.name : null,
      });
    }
  }

  const restrictions =
    tr.restrictions && tr.restrictions.reason
      ? tr.restrictions.reason
      : null;

  let playability_status = 'unknown';
  if (typeof tr.is_playable === 'boolean') {
    playability_status = tr.is_playable ? 'playable' : 'not_playable';
  } else if (restrictions) {
    playability_status = 'restricted';
  }

  const external_ids =
    tr.external_ids && typeof tr.external_ids === 'object'
      ? tr.external_ids
      : null;

  return {
    parsed: true,
    spotify_id: typeof tr.id === 'string' ? tr.id : null,
    name: typeof tr.name === 'string' ? tr.name : null,
    uri: typeof tr.uri === 'string' ? tr.uri : null,
    duration_ms: typeof tr.duration_ms === 'number' ? tr.duration_ms : null,
    explicit: typeof tr.explicit === 'boolean' ? tr.explicit : null,
    disc_number: typeof tr.disc_number === 'number' ? tr.disc_number : null,
    track_number: typeof tr.track_number === 'number' ? tr.track_number : null,
    is_playable:
      typeof tr.is_playable === 'boolean' ? tr.is_playable : null,
    playability_status,
    restrictions,
    popularity: typeof tr.popularity === 'number' ? tr.popularity : null,
    preview_url:
      tr.preview_url === null || typeof tr.preview_url === 'string'
        ? tr.preview_url
        : null,
    is_local: typeof tr.is_local === 'boolean' ? tr.is_local : null,
    isrc:
      external_ids && typeof external_ids.isrc === 'string'
        ? external_ids.isrc
        : null,
    artists,
    album: album
      ? {
          id: typeof album.id === 'string' ? album.id : null,
          name: typeof album.name === 'string' ? album.name : null,
          release_date:
            typeof album.release_date === 'string' ? album.release_date : null,
          release_date_precision:
            typeof album.release_date_precision === 'string'
              ? album.release_date_precision
              : null,
          album_type:
            typeof album.album_type === 'string' ? album.album_type : null,
          total_tracks:
            typeof album.total_tracks === 'number' ? album.total_tracks : null,
        }
      : null,
    http_200_playable: null,
  };
}

/**
 * @param {object} parsed - parse_track_catalog_response 結果
 */
export function apply_playability_note(parsed) {
  if (!parsed || !parsed.parsed) {
    return parsed;
  }
  parsed.http_200_playable =
    parsed.playability_status === 'playable'
      ? true
      : parsed.playability_status === 'not_playable' ||
          parsed.playability_status === 'restricted'
        ? false
        : null;
  return parsed;
}

/**
 * @param {string} track_id
 * @param {(id: string) => Promise<unknown>} fetch_track
 */
export async function probe_single_track(track_id, fetch_track) {
  const endpoint = `GET /v1/tracks/${track_id}`;
  try {
    const body = await fetch_track(track_id);
    const meta = apply_playability_note(parse_track_catalog_response(body));
    return {
      ok: true,
      http_status: 200,
      endpoint,
      track_id,
      metadata: meta,
      message: null,
      spotify_error: null,
      retry_after_sec: null,
    };
  } catch (err) {
    return probe_track_fail(endpoint, track_id, err);
  }
}

/**
 * @param {string} label
 * @param {string} track_id
 * @param {unknown} err
 */
function probe_track_fail(label, track_id, err) {
  if (err instanceof SpotifyRequestError) {
    return {
      ok: false,
      http_status: err.status || null,
      endpoint: label,
      track_id,
      metadata: null,
      message: err.message,
      spotify_error: spotify_error_summary(err.body),
      retry_after_sec: err.retry_after_sec || null,
      rate_limit_abort: err.status === 429,
    };
  }
  const msg = err && err.message ? err.message : String(err);
  return {
    ok: false,
    http_status: null,
    endpoint: label,
    track_id,
    metadata: null,
    message: msg,
    spotify_error: null,
    retry_after_sec: null,
    rate_limit_abort: false,
  };
}

/**
 * @param {object} [params]
 * @param {string[]} [params.track_ids]
 * @param {(id: string) => Promise<unknown>} [params.fetch_track]
 * @param {number} [params.max_tracks]
 */
export async function run_tracks_probe(params) {
  const opts = params || {};
  const max_tracks =
    typeof opts.max_tracks === 'number' ? opts.max_tracks : PROBE_TRACKS_MAX;
  const cap = max_tracks > PROBE_TRACKS_MAX ? PROBE_TRACKS_MAX : max_tracks;

  let track_ids = opts.track_ids;
  let id_only_pool_size = null;

  if (!track_ids) {
    const loaded = load_library_v2_for_probe();
    id_only_pool_size = select_id_only_tracks_from_index(
      loaded.track_index,
      999999
    ).length;
    track_ids = select_id_only_tracks_from_index(loaded.track_index, cap);
  }

  const fetch_track =
    opts.fetch_track ||
    function (id) {
      return fetch_track_catalog(id, PROBE_SPOTIFY_GET_OPTS);
    };

  const to_query = track_ids.slice(0, cap);
  /** @type {object[]} */
  const results = [];
  let stopped_early = false;
  let stop_reason = null;

  for (let i = 0; i < to_query.length; i += 1) {
    const id = to_query[i];
    const row = await probe_single_track(id, fetch_track);
    results.push(row);

    if (
      !row.ok &&
      row.rate_limit_abort &&
      row.retry_after_sec != null &&
      row.retry_after_sec > PROBE_SPOTIFY_GET_OPTS.max_retry_after_sec
    ) {
      stopped_early = true;
      stop_reason = '429 Retry-After 超過安全等待上限，停止後續查詢。';
      break;
    }
    if (!row.ok && row.http_status === 429 && row.message.indexOf('超過允許等待') >= 0) {
      stopped_early = true;
      stop_reason = row.message;
      break;
    }
  }

  let success_count = 0;
  let fail_count = 0;
  for (let r = 0; r < results.length; r += 1) {
    if (results[r].ok) {
      success_count += 1;
    } else {
      fail_count += 1;
    }
  }

  return {
    endpoint_mode: 'GET /v1/tracks/{id}（逐首，不使用批次 ?ids=）',
    max_queries: cap,
    queries_attempted: results.length,
    id_only_pool_size,
    selected_track_ids: to_query,
    results,
    success_count,
    fail_count,
    stopped_early,
    stop_reason,
  };
}
