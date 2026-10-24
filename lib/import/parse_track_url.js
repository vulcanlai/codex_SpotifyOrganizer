/**
 * 解析單行 Spotify 歌曲識別（離線，不呼叫 API）
 */

/** Spotify track ID 通常為 22 字元 Base62 */
const TRACK_ID_PATTERN = /^[0-9A-Za-z]{10,32}$/;

/**
 * @param {string} raw_line
 * @param {number} line_number - 1 起算（含原始檔行號）
 * @returns {{ skipped?: true } | { ok: true, spotify_id: string, uri: string, spotify_url: string } | { ok: false, line_number: number, error: string, raw: string }}
 */
export function parse_spotify_track_line(raw_line, line_number) {
  const trimmed = typeof raw_line === 'string' ? raw_line.trim() : '';
  if (!trimmed) {
    return { skipped: true };
  }

  const uri_match = trimmed.match(/^spotify:track:([0-9A-Za-z]+)$/i);
  if (uri_match) {
    const spotify_id = uri_match[1];
    if (!TRACK_ID_PATTERN.test(spotify_id)) {
      return invalid_line(line_number, trimmed, 'spotify URI 中的 track ID 格式無效');
    }
    return ok_track(spotify_id);
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return invalid_line(line_number, trimmed, '無法解析為 URL 或 spotify:track URI');
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'open.spotify.com' && !host.endsWith('.spotify.com')) {
    return invalid_line(line_number, trimmed, '非 Spotify 網域');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || parts[0] !== 'track') {
    return invalid_line(
      line_number,
      trimmed,
      '路徑必須為 /track/{id}（此列可能為歌單或專輯連結）'
    );
  }

  const spotify_id = parts[1];
  if (!TRACK_ID_PATTERN.test(spotify_id)) {
    return invalid_line(line_number, trimmed, 'URL 中的 track ID 格式無效');
  }

  return ok_track(spotify_id);
}

/**
 * @param {string} text
 * @returns {{ lines: string[], line_numbers: number[] }}
 */
export function split_lines_with_numbers(text) {
  const raw_lines = text.split(/\r?\n/);
  const lines = [];
  const line_numbers = [];
  for (let i = 0; i < raw_lines.length; i += 1) {
    lines.push(raw_lines[i]);
    line_numbers.push(i + 1);
  }
  return { lines, line_numbers };
}

function ok_track(spotify_id) {
  return {
    ok: true,
    spotify_id,
    uri: `spotify:track:${spotify_id}`,
    spotify_url: `https://open.spotify.com/track/${spotify_id}`,
  };
}

function invalid_line(line_number, raw, error) {
  return {
    ok: false,
    line_number,
    error,
    raw,
  };
}

/**
 * 從匯入檔名取得 playlist id（不含副檔名）
 * @param {string} filename
 */
export function playlist_id_from_filename(filename) {
  const base = filename.replace(/\\/g, '/').split('/').pop() || '';
  if (!base.toLowerCase().endsWith('.txt')) {
    return null;
  }
  const id = base.slice(0, -4).trim();
  if (!id || !/^[0-9A-Za-z]+$/.test(id)) {
    return null;
  }
  return id;
}
