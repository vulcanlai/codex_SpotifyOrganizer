/**
 * MVP 智慧歌單名稱／ID 解析（資料來源：catalog + sync-manifest）
 */
import fs from 'node:fs';
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';
import { MAIN_GENRES, is_main_genre_code } from '../genre_taxonomy.js';
import {
  EMOTION_CODES,
  EMOTIONS_BY_CODE,
  emotion_label_zh,
} from '../g3_emotion/emotion_taxonomy.js';
import {
  LANG_BUCKET_LABEL_ZH,
  MVP_LANG_GENRE_PLAYLIST_ID_PREFIX,
  mvp_lang_genre_playlist_id,
} from '../mvp_language_buckets.js';
import { mvp_spotify_emotion_title_zh } from '../mvp_spotify_playlist_naming.js';
import { resolve_allowed_data_file_path } from './safe_data_path.js';

export class MvpPlaylistRegistryPathError extends Error {
  /**
   * @param {string} code
   * @param {string} message_zh
   */
  constructor(code, message_zh) {
    super(message_zh);
    this.name = 'MvpPlaylistRegistryPathError';
    this.code = code;
    this.message_zh = message_zh;
  }
}

export const MVP_CATALOG_PATH = path.join(
  CLASSIFICATION_DIR,
  'mvp-smart-playlists',
  'catalog.json'
);
export const MVP_SYNC_MANIFEST_PATH = path.join(
  CLASSIFICATION_DIR,
  'mvp-smart-playlists',
  'sync-manifest.json'
);

/** 常見別名／簡稱（正規化後比對） */
const PLAYLIST_QUERY_ALIASES = {
  英語名謠: '英語民謠',
  英語民谣: '英語民謠',
  配樂器樂: '配樂 / 器樂',
  配乐器乐: '配樂 / 器樂',
  深夜沉靜: '深夜 / 沉靜',
  深夜静: '深夜 / 沉靜',
  輕鬆舒服: '輕鬆 / 舒服',
  輕快愉悅: '輕快 / 愉悅',
};

/**
 * @param {string} text
 */
export function normalize_playlist_query(text) {
  if (typeof text !== 'string') {
    return '';
  }
  let s = text.trim();
  // 🎵 為 UTF-16 surrogate pair，不可 slice(1)
  s = s.replace(/^\uD83C\uDFB5\s*/, '');
  s = s.replace(/^🎵\s/u, '');
  s = s.split('／').join(' / ');
  s = s.replace(/\s*\/\s*/g, ' / ');
  s = s.replace(/[·・]/g, ' / ');
  while (s.indexOf('  ') >= 0) {
    s = s.replace(/  +/g, ' ');
  }
  if (s.length >= 2 && s.slice(-2) === '音樂') {
    s = s.slice(0, -2).trim();
  }
  if (PLAYLIST_QUERY_ALIASES[s]) {
    s = PLAYLIST_QUERY_ALIASES[s];
  }
  return s;
}

/**
 * @param {string} text
 */
function normalize_for_fuzzy(text) {
  return normalize_playlist_query(text)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\/\-_]/g, '');
}

/**
 * @param {string} a
 * @param {string} b
 */
function levenshtein(a, b) {
  if (a === b) {
    return 0;
  }
  const m = a.length;
  const n = b.length;
  if (m === 0) {
    return n;
  }
  if (n === 0) {
    return m;
  }
  /** @type {number[]} */
  let prev = [];
  /** @type {number[]} */
  let cur = [];
  for (let j = 0; j <= n; j += 1) {
    prev[j] = j;
  }
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[n];
}

/**
 * @param {object} [opts]
 */
export function load_mvp_playlist_registry(opts) {
  const options = opts || {};
  let catalog_path = MVP_CATALOG_PATH;
  let manifest_path = MVP_SYNC_MANIFEST_PATH;
  if (options.catalog_path) {
    const allowed = resolve_allowed_data_file_path(options.catalog_path);
    if (!allowed) {
      throw new MvpPlaylistRegistryPathError(
        'catalog_path_not_allowed',
        'catalog_path 不在允許的 backup/data 目錄內。'
      );
    }
    catalog_path = allowed;
  }
  if (options.manifest_path) {
    const allowed = resolve_allowed_data_file_path(options.manifest_path);
    if (!allowed) {
      throw new MvpPlaylistRegistryPathError(
        'manifest_path_not_allowed',
        'manifest_path 不在允許的 backup/data 目錄內。'
      );
    }
    manifest_path = allowed;
  }

  /** @type {object[]} */
  const entries = [];

  if (fs.existsSync(catalog_path)) {
    const catalog = JSON.parse(fs.readFileSync(catalog_path, 'utf8'));
    const lg = catalog.language_genre_playlists || catalog.genre_playlists || [];
    for (let i = 0; i < lg.length; i += 1) {
      const pl = lg[i];
      entries.push({
        playlist_id: pl.playlist_id,
        kind: 'language_genre',
        label_zh: pl.label_zh,
        language_bucket: pl.language_bucket,
        primary_genre: pl.primary_genre,
        display_names: build_lang_genre_display_names(pl),
      });
    }
    const emo = catalog.emotion_playlists_tentative || [];
    for (let e = 0; e < emo.length; e += 1) {
      const pl = emo[e];
      entries.push({
        playlist_id: pl.playlist_id,
        kind: 'emotion_tentative',
        label_zh: pl.label_zh,
        emotion_code: pl.emotion_code,
        display_names: build_emotion_display_names(pl),
      });
    }
  }

  if (fs.existsSync(manifest_path)) {
    const manifest = JSON.parse(fs.readFileSync(manifest_path, 'utf8'));
    const keys = Object.keys(manifest.playlists || {}).sort();
    for (let k = 0; k < keys.length; k += 1) {
      const pid = keys[k];
      const row = manifest.playlists[pid];
      let found = false;
      for (let i = 0; i < entries.length; i += 1) {
        if (entries[i].playlist_id === pid) {
          found = true;
          merge_display_names(entries[i], [
            row.spotify_name,
            row.catalog_display_name,
          ]);
          break;
        }
      }
      if (!found && pid.indexOf('emotion:') === 0) {
        const code = pid.slice('emotion:'.length);
        entries.push({
          playlist_id: pid,
          kind: 'emotion_tentative',
          label_zh: (EMOTIONS_BY_CODE[code] && EMOTIONS_BY_CODE[code].label_zh) || code,
          emotion_code: code,
          display_names: [
            mvp_spotify_emotion_title_zh(code),
            emotion_label_zh(code),
          ],
        });
      }
    }
  }

  // 補齊 42 張語言×曲風組合（catalog 可能只列有曲目的歌單）
  const buckets = Object.keys(LANG_BUCKET_LABEL_ZH);
  for (let b = 0; b < buckets.length; b += 1) {
    const bucket = buckets[b];
    for (let g = 0; g < MAIN_GENRES.length; g += 1) {
      const genre = MAIN_GENRES[g];
      const pid = mvp_lang_genre_playlist_id(bucket, genre.code);
      if (entries.some(function (e) { return e.playlist_id === pid; })) {
        continue;
      }
      const label_zh =
        LANG_BUCKET_LABEL_ZH[bucket] + genre.label_zh + '音樂';
      entries.push({
        playlist_id: pid,
        kind: 'language_genre',
        label_zh: label_zh,
        language_bucket: bucket,
        primary_genre: genre.code,
        display_names: build_lang_genre_display_names({
          language_bucket: bucket,
          primary_genre: genre.code,
          label_zh: label_zh,
        }),
      });
    }
  }

  for (let c = 0; c < EMOTION_CODES.length; c += 1) {
    const code = EMOTION_CODES[c];
    const pid = 'emotion:' + code;
    if (entries.some(function (e) { return e.playlist_id === pid; })) {
      continue;
    }
    entries.push({
      playlist_id: pid,
      kind: 'emotion_tentative',
      label_zh: emotion_label_zh(code) + '（暫定參考）',
      emotion_code: code,
      display_names: build_emotion_display_names({ emotion_code: code }),
    });
  }

  return { entries: entries, catalog_path: catalog_path, manifest_path: manifest_path };
}

function merge_display_names(entry, names) {
  const set = {};
  const list = entry.display_names || [];
  for (let i = 0; i < list.length; i += 1) {
    set[normalize_playlist_query(list[i])] = list[i];
  }
  for (let n = 0; n < names.length; n += 1) {
    const raw = names[n];
    if (!raw) {
      continue;
    }
    const key = normalize_playlist_query(raw);
    if (key && !set[key]) {
      set[key] = raw;
    }
  }
  entry.display_names = Object.keys(set).map(function (k) {
    return set[k];
  });
}

function build_lang_genre_display_names(pl) {
  const names = [];
  if (pl.label_zh) {
    names.push(pl.label_zh);
    if (pl.label_zh.slice(-2) === '音樂') {
      names.push(pl.label_zh.slice(0, -2));
    }
  }
  const bucket = pl.language_bucket;
  const genre = pl.primary_genre;
  if (bucket && genre && is_main_genre_code(genre)) {
    for (let i = 0; i < MAIN_GENRES.length; i += 1) {
      if (MAIN_GENRES[i].code === genre) {
        const lang = LANG_BUCKET_LABEL_ZH[bucket] || bucket;
        names.push(lang + MAIN_GENRES[i].label_zh);
        names.push(lang + ' / ' + MAIN_GENRES[i].label_zh);
        break;
      }
    }
  }
  return unique_nonempty(names);
}

function build_emotion_display_names(pl) {
  const code = pl.emotion_code || (pl.playlist_id && pl.playlist_id.replace('emotion:', ''));
  const names = [];
  if (pl.label_zh) {
    names.push(pl.label_zh.replace(/（暫定參考）$/, ''));
  }
  if (code) {
    names.push(emotion_label_zh(code));
    names.push(mvp_spotify_emotion_title_zh(code));
  }
  return unique_nonempty(names);
}

function unique_nonempty(arr) {
  const out = [];
  const seen = {};
  for (let i = 0; i < arr.length; i += 1) {
    const v = arr[i];
    if (!v || seen[v]) {
      continue;
    }
    seen[v] = true;
    out.push(v);
  }
  return out;
}

/**
 * @param {object} registry
 * @param {string} playlist_id
 */
export function registry_get_by_id(registry, playlist_id) {
  const entries = registry.entries || [];
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].playlist_id === playlist_id) {
      return entries[i];
    }
  }
  return null;
}

/**
 * @param {string} query
 * @param {object} registry
 * @param {object} [opts]
 */
export function match_mvp_playlist_query(query, registry, opts) {
  const options = opts || {};
  const q_norm = normalize_playlist_query(query);
  const q_fuzzy = normalize_for_fuzzy(query);
  if (!q_norm && !q_fuzzy) {
    return { status: 'none', query: query, matches: [], reason_zh: '空字串' };
  }

  if (
    query.indexOf(MVP_LANG_GENRE_PLAYLIST_ID_PREFIX) === 0 ||
    query.indexOf('emotion:') === 0
  ) {
    const hit = registry_get_by_id(registry, query);
    if (hit) {
      return { status: 'unique', query: query, matches: [hit], match_method: 'playlist_id' };
    }
    return {
      status: 'none',
      query: query,
      matches: [],
      reason_zh: 'playlist_id 不在 MVP registry',
    };
  }

  // 純曲風簡稱優先（避免 manifest「🎵 民謠音樂」誤匹配單一語言桶）
  const genre_only_first = match_genre_only_query(q_norm, registry, options);
  if (genre_only_first && genre_only_first.status === 'ambiguous') {
    return genre_only_first;
  }

  /** @type {object[]} */
  const exact = [];
  /** @type {object[]} */
  const fuzzy = [];
  const entries = registry.entries || [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (options.language_bucket && entry.language_bucket) {
      if (entry.language_bucket !== options.language_bucket) {
        continue;
      }
    }
    const names = entry.display_names || [];
    for (let n = 0; n < names.length; n += 1) {
      const nn = normalize_playlist_query(names[n]);
      if (nn === q_norm || normalize_for_fuzzy(names[n]) === q_fuzzy) {
        exact.push(entry);
        break;
      }
    }
    if (exact.indexOf(entry) >= 0) {
      continue;
    }
    const label_norm = normalize_playlist_query(entry.label_zh || '');
    if (label_norm === q_norm) {
      exact.push(entry);
      continue;
    }
    const label_f = normalize_for_fuzzy(entry.label_zh || '');
    const dist = levenshtein(label_f, q_fuzzy);
    const threshold = Math.max(2, Math.floor(Math.max(label_f.length, q_fuzzy.length) * 0.25));
    if (q_fuzzy.length >= 3 && dist <= threshold) {
      fuzzy.push({ entry: entry, distance: dist });
    }
  }

  const uniq_exact = dedupe_entries(exact);
  if (genre_only_first && genre_only_first.status === 'unique') {
    return genre_only_first;
  }
  if (uniq_exact.length === 1) {
    return {
      status: 'unique',
      query: query,
      matches: uniq_exact,
      match_method: 'exact_or_alias',
    };
  }
  if (uniq_exact.length > 1) {
    return {
      status: 'ambiguous',
      query: query,
      matches: uniq_exact,
      reason_zh: '多名稱精確命中不同歌單，請改用 playlist_id 或指定語言桶。',
    };
  }

  fuzzy.sort(function (a, b) {
    return a.distance - b.distance;
  });
  const fuzzy_entries = dedupe_entries(
    fuzzy.map(function (f) {
      return f.entry;
    })
  );
  if (fuzzy_entries.length === 1) {
    return {
      status: 'unique',
      query: query,
      matches: fuzzy_entries,
      match_method: 'fuzzy',
      note_zh: '以有限度錯字容忍匹配；請確認後再套用。',
    };
  }
  if (fuzzy_entries.length > 1) {
    return {
      status: 'ambiguous',
      query: query,
      matches: fuzzy_entries,
      reason_zh: '模糊匹配命中多張歌單，拒絕自動解析。',
    };
  }

  if (genre_only_first) {
    return genre_only_first;
  }

  return {
    status: 'none',
    query: query,
    matches: [],
    reason_zh: '找不到對應 MVP 歌單',
  };
}

/**
 * @param {string} q_norm
 * @param {object} registry
 * @param {object} options
 */
function match_genre_only_query(q_norm, registry, options) {
  if (!q_norm || q_norm.indexOf(' ') >= 0 || q_norm.indexOf('/') >= 0) {
    return null;
  }
  /** @type {string|null} */
  let genre_code = null;
  for (let i = 0; i < MAIN_GENRES.length; i += 1) {
    const g = MAIN_GENRES[i];
    if (g.label_zh === q_norm || q_norm === g.label_zh.replace(/\／.*/, '')) {
      genre_code = g.code;
      break;
    }
  }
  if (!genre_code) {
    return null;
  }
  /** @type {object[]} */
  const hits = [];
  const entries = registry.entries || [];
  for (let e = 0; e < entries.length; e += 1) {
    const entry = entries[e];
    if (entry.kind !== 'language_genre' || entry.primary_genre !== genre_code) {
      continue;
    }
    if (options.language_bucket && entry.language_bucket !== options.language_bucket) {
      continue;
    }
    hits.push(entry);
  }
  const uniq = dedupe_entries(hits);
  if (uniq.length > 1) {
    return {
      status: 'ambiguous',
      query: q_norm,
      matches: uniq,
      reason_zh: '僅曲風簡稱命中多個語言桶；請加上語言（例：英語民謠）或 --language-bucket。',
    };
  }
  if (uniq.length === 1) {
    return {
      status: 'unique',
      query: q_norm,
      matches: uniq,
      match_method: 'genre_only',
    };
  }
  return null;
}

function dedupe_entries(list) {
  /** @type {Record<string, object>} */
  const by_id = {};
  for (let i = 0; i < list.length; i += 1) {
    by_id[list[i].playlist_id] = list[i];
  }
  return Object.keys(by_id)
    .sort()
    .map(function (k) {
      return by_id[k];
    });
}

/**
 * @param {string[]} queries
 * @param {object} registry
 * @param {object} [opts]
 */
/**
 * Web UI／明確 playlist_id 多選（不做模糊匹配）
 * @param {string[]} ids
 * @param {object} registry
 */
export function resolve_playlist_ids(ids, registry) {
  const entries = registry.entries || [];
  /** @type {Record<string, object>} */
  const by_id = {};
  for (let i = 0; i < entries.length; i += 1) {
    by_id[entries[i].playlist_id] = entries[i];
  }
  /** @type {object[]} */
  const resolved = [];
  /** @type {object[]} */
  const blocked = [];
  const list = Array.isArray(ids) ? ids : [];
  for (let k = 0; k < list.length; k += 1) {
    const id = list[k];
    if (typeof id !== 'string' || !id.trim()) {
      blocked.push({
        query: String(id),
        status: 'invalid',
        reason_zh: '非法 playlist_id',
        matches: [],
      });
      continue;
    }
    const pid = id.trim();
    const entry = by_id[pid];
    if (!entry) {
      blocked.push({
        query: pid,
        status: 'none',
        reason_zh: '找不到對應 MVP 歌單 ID',
        matches: [],
      });
      continue;
    }
    resolved.push({
      query: pid,
      playlist: entry,
      match_method: 'by_id',
      note_zh: null,
    });
  }
  return {
    ok: blocked.length === 0,
    resolved: resolved,
    blocked: blocked,
    mvp_playlist_ids: dedupe_playlist_ids(
      resolved
        .filter(function (r) {
          return r.playlist.kind === 'language_genre';
        })
        .map(function (r) {
          return r.playlist.playlist_id;
        })
    ),
    emotion_playlist_ids: dedupe_playlist_ids(
      resolved
        .filter(function (r) {
          return r.playlist.kind === 'emotion_tentative';
        })
        .map(function (r) {
          return r.playlist.playlist_id;
        })
    ),
  };
}

export function resolve_playlist_queries(queries, registry, opts) {
  /** @type {object[]} */
  const resolved = [];
  /** @type {object[]} */
  const blocked = [];
  for (let i = 0; i < queries.length; i += 1) {
    const q = queries[i];
    const m = match_mvp_playlist_query(q, registry, opts);
    if (m.status === 'unique') {
      resolved.push({
        query: q,
        playlist: m.matches[0],
        match_method: m.match_method,
        note_zh: m.note_zh || null,
      });
    } else {
      blocked.push(m);
    }
  }
  return {
    ok: blocked.length === 0,
    resolved: resolved,
    blocked: blocked,
    mvp_playlist_ids: dedupe_playlist_ids(
      resolved
        .filter(function (r) {
          return r.playlist.kind === 'language_genre';
        })
        .map(function (r) {
          return r.playlist.playlist_id;
        })
    ),
    emotion_playlist_ids: dedupe_playlist_ids(
      resolved
        .filter(function (r) {
          return r.playlist.kind === 'emotion_tentative';
        })
        .map(function (r) {
          return r.playlist.playlist_id;
        })
    ),
  };
}

function dedupe_playlist_ids(ids) {
  return Array.from(new Set(ids)).sort();
}
