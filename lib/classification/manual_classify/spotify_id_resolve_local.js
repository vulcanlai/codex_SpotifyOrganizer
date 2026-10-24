/**
 * 純 Spotify ID 本機類型判斷（library-v2、album-tracks；不呼叫 API）
 */
import { parse_spotify_id_list, is_valid_spotify_id } from './spotify_id_parse.js';
import { load_album_tracks_doc, find_album_section } from './album_tracks_resolve.js';
import { load_library_v2_for_probe } from '../../probe/library_v2_select.js';

/**
 * @param {string} id
 * @param {object} [opts]
 */
export function local_index_lookup_spotify_id(id, opts) {
  const options = opts || {};
  if (!is_valid_spotify_id(id)) {
    return { in_album_tracks: false, in_library_track: false };
  }
  let in_album_tracks = false;
  const loaded = load_album_tracks_doc(options);
  if (loaded.doc && find_album_section(loaded.doc, id)) {
    in_album_tracks = true;
  }
  const library = load_library_v2_for_probe(options);
  const in_library_track = !!(library.track_index && library.track_index[id]);
  return { in_album_tracks: in_album_tracks, in_library_track: in_library_track };
}

/**
 * @param {string} id
 * @param {object} [opts]
 */
export function resolve_unknown_spotify_id(id, opts) {
  const options = opts || {};
  const hint =
    options.id_type_hint ||
    (options.spotify_id_kind && options.spotify_id_kind !== 'auto'
      ? options.spotify_id_kind
      : null);
  if (hint === 'track') {
    return { kind: 'track', id: id, source: 'user_hint' };
  }
  if (hint === 'album') {
    return { kind: 'album', id: id, source: 'user_hint' };
  }
  const lookup = local_index_lookup_spotify_id(id, options);
  if (lookup.in_album_tracks && !lookup.in_library_track) {
    return { kind: 'album', id: id, source: 'album_tracks_index' };
  }
  if (lookup.in_library_track && !lookup.in_album_tracks) {
    return { kind: 'track', id: id, source: 'library_v2_index' };
  }
  if (lookup.in_album_tracks && lookup.in_library_track) {
    return {
      kind: 'ambiguous',
      id: id,
      reason_zh: '本機 album-tracks 與 library-v2 同時命中，無法自動判定。',
    };
  }
  return {
    kind: 'needs_hint',
    id: id,
    reason_zh: '純 ID 無類型；本機索引未命中，請選 Track／Album 或使用完整 URL。',
  };
}

/**
 * @param {object} parsed - parse_spotify_id_list 結果
 * @param {object} [opts]
 */
export function apply_local_resolution_to_parsed(parsed, opts) {
  const options = opts || {};
  const p = parsed || { tracks: [], albums: [], unknown_ids: [], invalid_tokens: [] };
  /** @type {Set<string>} */
  const tracks = new Set(p.tracks || []);
  /** @type {Set<string>} */
  const albums = new Set(p.albums || []);
  /** @type {object[]} */
  const needs_type_choice = [];
  /** @type {object[]} */
  const resolved_unknown = [];

  const hints = options.spotify_id_hints || options.id_hints || {};
  for (let i = 0; i < (p.unknown_ids || []).length; i += 1) {
    const id = p.unknown_ids[i];
    const r = resolve_unknown_spotify_id(id, {
      ...options,
      id_type_hint: hints[id] || options.spotify_id_kind,
    });
    resolved_unknown.push(r);
    if (r.kind === 'track') {
      tracks.add(id);
    } else if (r.kind === 'album') {
      albums.add(id);
    } else if (r.kind === 'ambiguous' || r.kind === 'needs_hint') {
      needs_type_choice.push(r);
    }
  }

  return {
    tracks: Array.from(tracks).sort(),
    albums: Array.from(albums).sort(),
    needs_type_choice: needs_type_choice,
    resolved_unknown: resolved_unknown,
    invalid_tokens: p.invalid_tokens || [],
  };
}

/**
 * Web／CLI 共用：將使用者輸入轉成 classify request 欄位
 * @param {object} body
 * @param {object} [opts]
 */
export function build_spotify_classify_input_fields(body, opts) {
  const options = opts || {};
  const spotify_input =
    typeof body.spotify_input === 'string' ? body.spotify_input.trim() : '';
  const parsed = parse_spotify_id_list(spotify_input);
  const resolution = apply_local_resolution_to_parsed(parsed, {
    album_tracks_path: body.album_tracks_path,
    library_v2_path: body.library_v2_path,
    spotify_id_kind: body.spotify_id_kind || null,
    spotify_id_hints: body.spotify_id_hints || null,
  });

  /** @type {object} */
  const out = {
    track_tokens: '',
    album: null,
    album_ids: [],
    spotify_input_resolution: {
      explicit_tracks: parsed.tracks,
      explicit_albums: parsed.albums,
      unknown_ids: parsed.unknown_ids,
      resolved_unknown: resolution.resolved_unknown,
      needs_type_choice: resolution.needs_type_choice,
      invalid_tokens: resolution.invalid_tokens,
    },
  };

  if (resolution.needs_type_choice.length > 0) {
    return out;
  }
  if (resolution.invalid_tokens.length > 0 && !parsed.tracks.length && !parsed.albums.length) {
    return out;
  }

  /** @type {string[]} */
  const track_lines = [];
  for (let t = 0; t < resolution.tracks.length; t += 1) {
    track_lines.push('spotify:track:' + resolution.tracks[t]);
  }
  out.track_tokens = track_lines.join('\n');

  const album_list = resolution.albums.slice();
  if (
    album_list.length === 1 &&
    resolution.tracks.length === 0 &&
    parsed.unknown_ids.length <= 1
  ) {
    out.album = album_list[0];
    out.track_tokens = '';
  } else if (album_list.length > 0) {
    out.album_ids = album_list;
    if (album_list.length === 1 && !out.track_tokens) {
      out.album = album_list[0];
    }
  }

  return out;
}
