/**
 * enrichment 快取唯讀信任判定（避免 id 不一致或假 ok 進分類）
 */
import { is_metadata_cache_complete, has_required_metadata_fields } from './track_entry.js';

const BLOCKED_STATUSES = [
  'not_found_404',
  'forbidden_403',
  'rate_limited_429',
  'network_error',
];

/**
 * @param {string} track_id
 * @param {object|null} entry
 * @returns {{ trusted: boolean, reason: string|null }}
 */
export function assess_enrichment_cache_entry(track_id, entry) {
  if (!entry || typeof entry !== 'object') {
    return { trusted: false, reason: 'missing_entry' };
  }
  if (entry.spotify_id && entry.spotify_id !== track_id) {
    return { trusted: false, reason: 'spotify_id_mismatch' };
  }
  if (BLOCKED_STATUSES.indexOf(entry.status) >= 0) {
    return { trusted: false, reason: 'blocked_status:' + entry.status };
  }
  if (entry.status === 'partial') {
    return { trusted: false, reason: 'partial_metadata' };
  }
  if (entry.status === 'ok') {
    if (!has_required_metadata_fields(entry)) {
      return { trusted: false, reason: 'ok_but_incomplete_fields' };
    }
    if (!is_metadata_cache_complete(entry)) {
      return { trusted: false, reason: 'ok_flag_inconsistent' };
    }
    return { trusted: true, reason: null };
  }
  return { trusted: false, reason: 'unknown_status:' + String(entry.status) };
}

/**
 * 供 merge／evidence 使用：僅在通過 guard 時視為可合併快取
 * @param {string} track_id
 * @param {object|null} entry
 */
export function cache_entry_trusted_for_merge(track_id, entry) {
  return assess_enrichment_cache_entry(track_id, entry).trusted;
}
