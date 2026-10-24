/**
 * 快取列：完整性判定與 API 回應轉換
 */
import {
  parse_track_catalog_response,
  apply_playability_note,
} from '../probe/tracks_probe.js';
import { is_weak_metadata_value } from '../merge/v2/metadata_merge.js';

/**
 * @param {object|null} entry
 */
export function has_required_metadata_fields(entry) {
  if (!entry) {
    return false;
  }
  if (is_weak_metadata_value(entry.name)) {
    return false;
  }
  const artists = entry.artists;
  if (!Array.isArray(artists) || !artists.length) {
    return false;
  }
  let has_artist = false;
  for (let i = 0; i < artists.length; i += 1) {
    const a = artists[i];
    if (a && (a.name || a.id)) {
      has_artist = true;
      break;
    }
  }
  if (!has_artist) {
    return false;
  }
  const album = entry.album;
  if (!album || (!album.id && is_weak_metadata_value(album.name))) {
    return false;
  }
  return true;
}

/**
 * @param {object|null} entry
 */
export function is_metadata_cache_complete(entry) {
  if (!entry || entry.status !== 'ok') {
    return false;
  }
  return has_required_metadata_fields(entry);
}

/**
 * @param {object} parsed - apply_playability_note 之後
 * @param {number} http_status
 */
export function build_cache_entry_from_api(parsed, http_status) {
  const fetched_at = new Date().toISOString();
  if (!parsed || !parsed.parsed) {
    return {
      spotify_id: null,
      status: 'partial',
      http_status,
      fetched_at,
      error_summary: parsed && parsed.message ? parsed.message : 'parse_failed',
      playability_status: 'unknown',
      is_playable: null,
    };
  }

  const entry = {
    spotify_id: parsed.spotify_id,
    uri: parsed.uri,
    name: parsed.name,
    artists: parsed.artists || [],
    album: parsed.album,
    duration_ms: parsed.duration_ms,
    isrc: parsed.isrc,
    explicit: parsed.explicit,
    is_playable:
      typeof parsed.is_playable === 'boolean' ? parsed.is_playable : null,
    restrictions: parsed.restrictions,
    playability_status: parsed.playability_status || 'unknown',
    http_status,
    fetched_at,
    error_summary: null,
  };

  if (http_status === 200) {
    entry.status = has_required_metadata_fields(entry) ? 'ok' : 'partial';
    if (entry.status === 'partial') {
      entry.error_summary = 'HTTP 200 但必要 metadata 欄位不完整';
    }
  }

  return entry;
}

/**
 * @param {unknown} body
 */
export function cache_entry_from_track_body(body) {
  const parsed = apply_playability_note(parse_track_catalog_response(body));
  return build_cache_entry_from_api(parsed, 200);
}

/**
 * @param {string} track_id
 * @param {object} err_info
 */
export function cache_entry_from_error(track_id, err_info) {
  const fetched_at = new Date().toISOString();
  return {
    spotify_id: track_id,
    uri: `spotify:track:${track_id}`,
    name: null,
    artists: [],
    album: null,
    duration_ms: null,
    isrc: null,
    explicit: null,
    is_playable: null,
    restrictions: null,
    playability_status: 'unknown',
    status: err_info.status,
    http_status: err_info.http_status,
    fetched_at,
    error_summary: err_info.message || null,
    next_retry_after: err_info.next_retry_after || null,
  };
}

/** 毫秒 */
export const COOLDOWN_MS = {
  not_found_404: 7 * 24 * 60 * 60 * 1000,
  forbidden_403: 7 * 24 * 60 * 60 * 1000,
  partial: 60 * 60 * 1000,
  network_error: 60 * 60 * 1000,
  rate_limited_429: 60 * 60 * 1000,
};

/**
 * @param {string} track_id
 * @param {object|null} cached
 * @param {object} v2_row
 * @param {number} now_ms
 * @param {object} [cooldowns]
 */
export function should_fetch_track(
  track_id,
  cached,
  v2_row,
  now_ms,
  cooldowns
) {
  const cd = cooldowns || COOLDOWN_MS;

  if (cached && is_metadata_cache_complete(cached)) {
    return { fetch: false, reason: 'cache_ok' };
  }

  if (cached && cached.next_retry_after) {
    const retry_at = Date.parse(cached.next_retry_after);
    if (Number.isFinite(retry_at) && now_ms < retry_at) {
      return { fetch: false, reason: 'cooldown' };
    }
  } else if (cached && cached.fetched_at && cached.status) {
    const fetched = Date.parse(cached.fetched_at);
    if (Number.isFinite(fetched)) {
      let cool = 0;
      if (cached.status === 'not_found_404') {
        cool = cd.not_found_404;
      } else if (cached.status === 'forbidden_403') {
        cool = cd.forbidden_403;
      } else if (
        cached.status === 'partial' ||
        cached.status === 'network_error'
      ) {
        cool = cd.partial;
      } else if (cached.status === 'rate_limited_429') {
        cool = cd.rate_limited_429;
      }
      if (cool > 0 && now_ms - fetched < cool) {
        return { fetch: false, reason: 'cooldown' };
      }
    }
  }

  return { fetch: true, reason: 'needs_enrichment' };
}

/**
 * @param {number} now_ms
 * @param {number} cooldown_ms
 */
export function iso_retry_after(now_ms, cooldown_ms) {
  return new Date(now_ms + cooldown_ms).toISOString();
}
