/**
 * 人工分類 Web UI：42 張智慧歌單排序（依 playlist_id metadata，非顯示名稱猜測）
 */
import { EMOTION_CODES } from '../g3_emotion/emotion_taxonomy.js';
import { MAIN_GENRES } from '../genre_taxonomy.js';

/** 曲風區塊順序（對應 MAIN_GENRES.code） */
export const UI_GENRE_SORT_CODES = [
  'pop',
  'folk',
  'rock',
  'metal_punk',
  'hip_hop',
  'electronic',
  'rnb_soul',
  'jazz',
  'classical',
  'soundtrack_instrumental',
  'country_blues',
  'reggae_world',
];

/** 語言桶順序（lg:v2 前綴後第一段） */
export const UI_LANG_BUCKET_SORT = [
  'mandarin',
  'english',
  'jp_kr',
  'other_lang',
  'unknown_or_instrumental',
];

/** @type {Record<string, string>} */
const GENRE_LABEL_BY_CODE = {};
for (let g = 0; g < MAIN_GENRES.length; g += 1) {
  GENRE_LABEL_BY_CODE[MAIN_GENRES[g].code] = MAIN_GENRES[g].label_zh;
}

/**
 * @param {object} pl
 */
export function parse_playlist_id_metadata(pl) {
  const row = pl || {};
  if (row.kind === 'emotion_tentative' || String(row.playlist_id || '').indexOf('emotion:') === 0) {
    const code =
      row.emotion_code || String(row.playlist_id || '').slice('emotion:'.length);
    return {
      section: 'emotion',
      emotion_code: code,
      primary_genre: null,
      language_bucket: null,
    };
  }
  let bucket = row.language_bucket || null;
  let genre = row.primary_genre || null;
  const pid = String(row.playlist_id || '');
  const m = pid.match(/^lg:v2:([^:]+):([^:]+)$/);
  if (m) {
    bucket = bucket || m[1];
    genre = genre || m[2];
  }
  return {
    section: 'language_genre',
    emotion_code: null,
    primary_genre: genre,
    language_bucket: bucket,
  };
}

/**
 * @param {object} pl
 */
export function playlist_sort_rank(pl) {
  const meta = parse_playlist_id_metadata(pl);
  if (meta.section === 'emotion') {
    const idx = EMOTION_CODES.indexOf(meta.emotion_code);
    return {
      tier: 0,
      genre_rank: 0,
      lang_rank: 0,
      emotion_rank: idx >= 0 ? idx : 999,
      tie_id: pl.playlist_id,
    };
  }
  if (meta.section === 'language_genre' && meta.primary_genre && meta.language_bucket) {
    const genre_rank = UI_GENRE_SORT_CODES.indexOf(meta.primary_genre);
    const lang_rank = UI_LANG_BUCKET_SORT.indexOf(meta.language_bucket);
    return {
      tier: 1,
      genre_rank: genre_rank >= 0 ? genre_rank : 998,
      lang_rank: lang_rank >= 0 ? lang_rank : 998,
      emotion_rank: 0,
      tie_id: pl.playlist_id,
    };
  }
  return {
    tier: 2,
    genre_rank: 999,
    lang_rank: 999,
    emotion_rank: 999,
    tie_id: pl.playlist_id,
  };
}

/**
 * @param {object} a
 * @param {object} b
 */
export function compare_playlists_for_ui(a, b) {
  const ra = playlist_sort_rank(a);
  const rb = playlist_sort_rank(b);
  if (ra.tier !== rb.tier) {
    return ra.tier - rb.tier;
  }
  if (ra.tier === 0 && ra.emotion_rank !== rb.emotion_rank) {
    return ra.emotion_rank - rb.emotion_rank;
  }
  if (ra.genre_rank !== rb.genre_rank) {
    return ra.genre_rank - rb.genre_rank;
  }
  if (ra.lang_rank !== rb.lang_rank) {
    return ra.lang_rank - rb.lang_rank;
  }
  return String(ra.tie_id).localeCompare(String(rb.tie_id));
}

/**
 * @param {object[]} playlists
 */
export function sort_playlists_for_ui(playlists) {
  return (playlists || []).slice().sort(compare_playlists_for_ui);
}

/**
 * @param {object} pl
 */
export function ui_group_key_for_playlist(pl) {
  const meta = parse_playlist_id_metadata(pl);
  if (meta.section === 'emotion') {
    return 'section:emotion';
  }
  if (meta.section === 'language_genre' && meta.primary_genre) {
    return 'genre:' + meta.primary_genre;
  }
  return 'section:other';
}

/**
 * @param {string} group_key
 * @param {object} pl
 */
export function ui_group_title_zh(group_key, pl) {
  if (group_key === 'section:emotion') {
    return '情緒';
  }
  if (group_key.indexOf('genre:') === 0) {
    const code = group_key.slice('genre:'.length);
    return GENRE_LABEL_BY_CODE[code] || code;
  }
  return '其他';
}

/**
 * 僅含實際有歌單的群組（已排序）
 * @param {object[]} playlists
 */
export function group_playlists_for_ui(playlists) {
  const sorted = sort_playlists_for_ui(playlists);
  /** @type {object[]} */
  const groups = [];
  /** @type {object|null} */
  let current = null;
  for (let i = 0; i < sorted.length; i += 1) {
    const pl = sorted[i];
    const key = ui_group_key_for_playlist(pl);
    if (!current || current.group_key !== key) {
      current = {
        group_key: key,
        title_zh: ui_group_title_zh(key, pl),
        playlists: [],
      };
      groups.push(current);
    }
    current.playlists.push(pl);
  }
  return groups;
}

/**
 * 盤點用：回傳 42 張的分組摘要
 * @param {object[]} playlists
 */
export function summarize_playlist_ui_groups(playlists) {
  return group_playlists_for_ui(playlists).map(function (g) {
    return {
      title_zh: g.title_zh,
      group_key: g.group_key,
      count: g.playlists.length,
      playlist_ids: g.playlists.map(function (p) {
        return p.playlist_id;
      }),
    };
  });
}
