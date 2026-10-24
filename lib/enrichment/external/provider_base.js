/**
 * 外部音樂資料 Provider 介面（G1 可擴充）
 */

/**
 * @typedef {object} ExternalTrackInput
 * @property {string} spotify_id
 * @property {string} title
 * @property {string[]} artists
 * @property {string} [album_name]
 * @property {string} [isrc]
 * @property {number|null} [duration_ms]
 * @property {string} [release_date]
 */

/**
 * @typedef {object} ExternalCandidate
 * @property {string} provider
 * @property {string} entity_type
 * @property {string} external_id
 * @property {string} title
 * @property {string[]} artist_names
 * @property {number|null} duration_ms
 * @property {string|null} first_release_date
 * @property {string[]} tags
 * @property {string} source_url
 * @property {number} match_score
 * @property {string[]} match_reasons
 */

/**
 * @param {object} provider
 * @returns {boolean}
 */
export function validate_provider(provider) {
  return (
    provider &&
    typeof provider.id === 'string' &&
    typeof provider.lookup_by_isrc === 'function' &&
    typeof provider.search_recording === 'function'
  );
}
