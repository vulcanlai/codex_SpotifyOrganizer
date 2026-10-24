/**
 * 解析 Spotify Track／Album ID 與 URL（不呼叫 API）
 */

const SPOTIFY_ID_RE = /^[0-9A-Za-z]{22}$/;

/**
 * @param {string} raw
 */
export function normalize_spotify_id_token(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  let s = raw.trim();
  if (!s) {
    return null;
  }
  const uri_match = s.match(/^spotify:(track|album):([0-9A-Za-z]{22})$/i);
  if (uri_match) {
    return { kind: uri_match[1].toLowerCase(), id: uri_match[2] };
  }
  const url_match = s.match(
    /open\.spotify\.com\/(intl-[a-z]{2}\/)?(track|album)\/([0-9A-Za-z]{22})/i
  );
  if (url_match) {
    return { kind: url_match[2].toLowerCase(), id: url_match[3] };
  }
  if (SPOTIFY_ID_RE.test(s)) {
    return { kind: 'unknown', id: s };
  }
  return null;
}

/**
 * 從多行／逗號／空白分隔字串解析 ID
 * @param {string|string[]} input
 * @returns {{ tracks: string[], albums: string[], unknown_ids: string[], invalid_tokens: string[] }}
 */
export function parse_spotify_id_list(input) {
  /** @type {string[]} */
  const tokens = [];
  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i += 1) {
      tokens.push(String(input[i]));
    }
  } else if (typeof input === 'string') {
    const parts = input.split(/[\s,;，；\n\r\t]+/);
    for (let p = 0; p < parts.length; p += 1) {
      const t = parts[p].trim();
      if (t) {
        tokens.push(t);
      }
    }
  }

  /** @type {Set<string>} */
  const tracks = new Set();
  /** @type {Set<string>} */
  const albums = new Set();
  /** @type {string[]} */
  const unknown_ids = [];
  /** @type {string[]} */
  const invalid_tokens = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const parsed = normalize_spotify_id_token(tokens[i]);
    if (!parsed) {
      invalid_tokens.push(tokens[i]);
      continue;
    }
    if (parsed.kind === 'track') {
      tracks.add(parsed.id);
    } else if (parsed.kind === 'album') {
      albums.add(parsed.id);
    } else {
      unknown_ids.push(parsed.id);
    }
  }

  return {
    tracks: Array.from(tracks).sort(),
    albums: Array.from(albums).sort(),
    unknown_ids: unknown_ids.sort(),
    invalid_tokens: invalid_tokens,
  };
}

/**
 * @param {string} id
 */
export function is_valid_spotify_id(id) {
  return typeof id === 'string' && SPOTIFY_ID_RE.test(id);
}
