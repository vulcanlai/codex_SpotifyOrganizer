/**
 * 待補齊佇列（依 ID 排序，不用 offset）
 */
import { is_id_only_track_row } from '../probe/library_v2_select.js';
import { should_fetch_track } from './track_entry.js';

/**
 * @param {Record<string, object>} track_index
 * @param {object} cache_doc
 * @param {number} now_ms
 * @param {object} [cooldowns]
 */
export function build_enrichment_queue(track_index, cache_doc, now_ms, cooldowns) {
  const ids = Object.keys(track_index || {}).sort();
  /** @type {string[]} */
  const queue = [];
  let skipped_cache_ok = 0;
  let skipped_v2_has_meta = 0;
  let skipped_cooldown = 0;

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const row = track_index[id];
    if (!is_id_only_track_row(row)) {
      skipped_v2_has_meta += 1;
      continue;
    }
    const cached = cache_doc.tracks_by_id[id] || null;
    const decision = should_fetch_track(id, cached, row, now_ms, cooldowns);
    if (!decision.fetch) {
      if (decision.reason === 'cache_ok') {
        skipped_cache_ok += 1;
      } else if (decision.reason === 'cooldown') {
        skipped_cooldown += 1;
      }
      continue;
    }
    queue.push(id);
  }

  return {
    queue,
    skipped_cache_ok,
    skipped_v2_has_meta,
    skipped_cooldown,
  };
}

/**
 * @param {Record<string, object>} track_index
 * @param {object} cache_doc
 * @param {number} now_ms
 */
export function count_enrichment_targets(track_index, cache_doc, now_ms) {
  const built = build_enrichment_queue(
    track_index,
    cache_doc,
    now_ms,
    { not_found_404: 0, forbidden_403: 0, partial: 0, network_error: 0, rate_limited_429: 0 }
  );
  return built.queue.length;
}
