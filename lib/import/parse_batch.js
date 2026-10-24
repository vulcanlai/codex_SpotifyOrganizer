/**
 * 解析貼上的多行歌曲網址（供 CLI 與 Web 共用）
 */
import crypto from 'node:crypto';
import {
  parse_spotify_track_line,
  split_lines_with_numbers,
} from './parse_track_url.js';

/**
 * 正規化批次文字以計算雜湊（偵測整批重複貼上）
 * @param {string} text
 */
export function compute_batch_content_hash(text) {
  const split = split_lines_with_numbers(text || '');
  const parts = [];
  for (let i = 0; i < split.lines.length; i += 1) {
    const t = split.lines[i].trim();
    if (t) {
      parts.push(t);
    }
  }
  return crypto.createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex');
}

/**
 * 建立單首匯入曲目（不捏造 metadata）
 */
export function build_manual_track_entry(params) {
  return {
    playlist_id: params.playlist_id,
    playlist_name: params.playlist_name,
    position: params.position,
    spotify_id: params.spotify_id,
    uri: params.uri,
    spotify_url: params.spotify_url,
    source: 'manual_import',
    track_status: 'ok',
    playability_status: 'unknown',
    name: null,
    artists: [],
    album_name: null,
    release_date: null,
    duration_ms: null,
    batch_id: params.batch_id || null,
  };
}

/**
 * @param {string} text
 * @param {object} ctx
 * @param {string} ctx.playlist_id
 * @param {string|null} ctx.playlist_name
 * @param {number} ctx.start_position
 * @param {string|null} [ctx.batch_id]
 */
export function parse_playlist_text(text, ctx) {
  const split = split_lines_with_numbers(text || '');
  const content_hash = compute_batch_content_hash(text || '');

  /** @type {object[]} */
  const tracks = [];
  /** @type {object[]} */
  const invalid_lines = [];
  const id_counts = {};
  let position = ctx.start_position || 0;

  for (let i = 0; i < split.lines.length; i += 1) {
    const line_no = split.line_numbers[i];
    const parsed = parse_spotify_track_line(split.lines[i], line_no);
    if (parsed.skipped) {
      continue;
    }
    if (!parsed.ok) {
      invalid_lines.push({
        line_number: parsed.line_number,
        error: parsed.error,
        raw: parsed.raw,
      });
      continue;
    }

    id_counts[parsed.spotify_id] = (id_counts[parsed.spotify_id] || 0) + 1;
    tracks.push(
      build_manual_track_entry({
        playlist_id: ctx.playlist_id,
        playlist_name: ctx.playlist_name,
        position,
        spotify_id: parsed.spotify_id,
        uri: parsed.uri,
        spotify_url: parsed.spotify_url,
        batch_id: ctx.batch_id || null,
      })
    );
    position += 1;
  }

  let duplicate_entries = 0;
  const keys = Object.keys(id_counts);
  for (let k = 0; k < keys.length; k += 1) {
    const c = id_counts[keys[k]];
    if (c > 1) {
      duplicate_entries += c - 1;
    }
  }

  return {
    tracks,
    invalid_lines,
    valid_count: tracks.length,
    invalid_count: invalid_lines.length,
    duplicate_entries,
    content_hash,
    next_position: position,
  };
}

/**
 * 預覽（不寫入）
 * @param {string} text
 * @param {object} ctx
 * @param {string[]} [existing_batch_hashes]
 */
export function preview_playlist_import(text, ctx, existing_batch_hashes) {
  const parsed = parse_playlist_text(text, {
    playlist_id: ctx.playlist_id,
    playlist_name: ctx.playlist_name,
    start_position: ctx.start_position || 0,
    batch_id: 'preview',
  });

  const hashes = existing_batch_hashes || [];
  const duplicate_batch = hashes.indexOf(parsed.content_hash) >= 0;

  return {
    valid_count: parsed.valid_count,
    invalid_count: parsed.invalid_count,
    duplicate_entries: parsed.duplicate_entries,
    duplicate_batch,
    duplicate_batch_message: duplicate_batch
      ? '此批次內容與先前匯入的某一批完全相同，可能為重複貼上。'
      : null,
    invalid_lines: parsed.invalid_lines,
    content_hash: parsed.content_hash,
  };
}
