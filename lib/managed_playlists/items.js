/**
 * 歌單項目正規化：保留順序、重複次數；local／無效／無法回傳獨立標示。
 */
import {
  ITEM_KIND_EPISODE,
  ITEM_KIND_LOCAL,
  ITEM_KIND_TRACK,
  ITEM_KIND_UNAVAILABLE,
} from './constants.js';
import { is_spotify_id, track_id_from_uri } from './identity.js';
import { resolve_media_from_row } from '../backup/track_normalize.js';

/**
 * @param {object[]} raw_items Spotify playlist items 分頁列
 */
export function normalize_playlist_items(raw_items) {
  const seen = new Map();
  const items = [];
  for (let i = 0; i < (raw_items || []).length; i += 1) {
    const row = raw_items[i] || {};
    const track = resolve_media_from_row(row);
    if (!track) {
      items.push({
        uri: null,
        track_id: null,
        kind: ITEM_KIND_UNAVAILABLE,
        occurrence: 1,
        name: null,
        artists: [],
        position: i,
      });
      continue;
    }
    if (track.is_local === true) {
      items.push({
        uri: track.uri || null,
        track_id: null,
        kind: ITEM_KIND_LOCAL,
        occurrence: 1,
        name: track.name || null,
        artists: artist_names(track),
        position: i,
      });
      continue;
    }
    if (track.type === 'episode') {
      items.push({
        uri: track.uri || null,
        track_id: track.id || null,
        kind: ITEM_KIND_EPISODE,
        occurrence: 1,
        name: track.name || null,
        artists: [],
        position: i,
      });
      continue;
    }
    const uri = typeof track.uri === 'string' ? track.uri : null;
    const track_id = track.id && is_spotify_id(track.id) ? track.id : track_id_from_uri(uri);
    if (!track_id) {
      items.push({
        uri: uri,
        track_id: null,
        kind: ITEM_KIND_UNAVAILABLE,
        occurrence: 1,
        name: track.name || null,
        artists: artist_names(track),
        position: i,
      });
      continue;
    }
    const next_occ = (seen.get(track_id) || 0) + 1;
    seen.set(track_id, next_occ);
    items.push({
      uri: uri || 'spotify:track:' + track_id,
      track_id: track_id,
      kind: ITEM_KIND_TRACK,
      occurrence: next_occ,
      name: track.name || null,
      artists: artist_names(track),
      position: i,
    });
  }
  return items;
}

function artist_names(track) {
  const artists = track && Array.isArray(track.artists) ? track.artists : [];
  return artists
    .map(function (a) {
      return typeof a === 'string' ? a : a && a.name;
    })
    .filter(Boolean);
}

/**
 * 以 (track_id, occurrence) 比較兩份有序項目。
 * @param {object[]} before
 * @param {object[]} after
 */
export function diff_playlist_items(before, after) {
  const prev = before || [];
  const next = after || [];
  const prev_keys = prev.map(item_key);
  const next_keys = next.map(item_key);
  const prev_set = new Set(prev_keys);
  const next_set = new Set(next_keys);
  const added = [];
  const removed = [];
  for (let i = 0; i < next.length; i += 1) {
    if (!prev_set.has(next_keys[i])) {
      added.push(next[i]);
    }
  }
  for (let j = 0; j < prev.length; j += 1) {
    if (!next_set.has(prev_keys[j])) {
      removed.push(prev[j]);
    }
  }
  const order_changed =
    prev_keys.length === next_keys.length &&
    prev_keys.join('\n') !== next_keys.join('\n') &&
    added.length === 0 &&
    removed.length === 0;
  const repeats = {};
  for (let k = 0; k < next.length; k += 1) {
    const id = next[k].track_id;
    if (!id) {
      continue;
    }
    repeats[id] = (repeats[id] || 0) + 1;
  }
  return {
    added: added,
    removed: removed,
    order_changed: order_changed,
    repeat_counts: repeats,
    before_count: prev.length,
    after_count: next.length,
  };
}

export function item_key(item) {
  if (!item) {
    return 'null';
  }
  if (item.track_id) {
    return item.track_id + '#' + (item.occurrence || 1);
  }
  return (item.kind || 'unknown') + ':' + (item.uri || item.position || '');
}

/**
 * 跨歌單移動只作展示假設；無法證明時不寫成正式事件。
 * @param {object[]} playlist_diffs
 */
export function possible_moves_from_diffs(playlist_diffs) {
  const removed_by_track = new Map();
  const added_by_track = new Map();
  for (let i = 0; i < (playlist_diffs || []).length; i += 1) {
    const row = playlist_diffs[i];
    const items_diff = row.items_diff || {};
    for (let r = 0; r < (items_diff.removed || []).length; r += 1) {
      const id = items_diff.removed[r].track_id;
      if (!id) {
        continue;
      }
      if (!removed_by_track.has(id)) {
        removed_by_track.set(id, []);
      }
      removed_by_track.get(id).push(row.spotify_playlist_id);
    }
    for (let a = 0; a < (items_diff.added || []).length; a += 1) {
      const id = items_diff.added[a].track_id;
      if (!id) {
        continue;
      }
      if (!added_by_track.has(id)) {
        added_by_track.set(id, []);
      }
      added_by_track.get(id).push(row.spotify_playlist_id);
    }
  }
  const guesses = [];
  for (const [track_id, from_ids] of removed_by_track) {
    const to_ids = added_by_track.get(track_id);
    if (!to_ids || !to_ids.length || !from_ids.length) {
      continue;
    }
    guesses.push({
      track_id: track_id,
      from_playlist_ids: from_ids,
      to_playlist_ids: to_ids,
      proven: false,
      note_zh: '僅展示為可能移動；各關係仍分別保存。',
    });
  }
  return guesses;
}
