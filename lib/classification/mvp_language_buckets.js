/**
 * MVP 智慧歌單：語言分層（依 index language tags，不推測）
 */
import { DIMENSION_LANGUAGE, DIMENSION_SPECIAL } from './dimensions.js';

export const LANG_BUCKET_MANDARIN = 'mandarin';
export const LANG_BUCKET_ENGLISH = 'english';
export const LANG_BUCKET_JP_KR = 'jp_kr';
export const LANG_BUCKET_OTHER = 'other_lang';
export const LANG_BUCKET_UNKNOWN_INSTRUMENTAL = 'unknown_or_instrumental';

/** 智慧歌單顯示用；分類 tag 仍可能為「國語」 */
export const LANG_BUCKET_LABEL_ZH = {
  mandarin: '華語',
  english: '英語',
  jp_kr: '日韓',
  other_lang: '其他語言',
  unknown_or_instrumental: '語言未知／純音樂',
};

/** 穩定 playlist_id 前綴（v2，與舊 genre: 區隔） */
export const MVP_LANG_GENRE_PLAYLIST_ID_PREFIX = 'lg:v2:';

/**
 * @param {object} row
 */
export function row_has_pure_instrumental_special(row) {
  const tags = (row && row.tags) || [];
  for (let i = 0; i < tags.length; i += 1) {
    const t = tags[i];
    if (t.dimension === DIMENSION_SPECIAL && t.value === '純音樂') {
      return true;
    }
  }
  return false;
}

/**
 * @param {object} row
 * @returns {string|null}
 */
export function primary_language_tag_value(row) {
  const tags = (row && row.tags) || [];
  /** @type {string|null} */
  let fallback = null;
  for (let i = 0; i < tags.length; i += 1) {
    const t = tags[i];
    if (t.dimension !== DIMENSION_LANGUAGE || !t.value) {
      continue;
    }
    if (t.is_manual_override === true || t.is_g3_f_adopt === true) {
      return t.value;
    }
    if (!fallback) {
      fallback = t.value;
    }
  }
  return fallback;
}

/**
 * @param {string|null} lang_value
 */
export function language_value_to_bucket(lang_value) {
  if (!lang_value || lang_value === '未確認') {
    return LANG_BUCKET_UNKNOWN_INSTRUMENTAL;
  }
  if (lang_value === '國語') {
    return LANG_BUCKET_MANDARIN;
  }
  if (lang_value === '英文') {
    return LANG_BUCKET_ENGLISH;
  }
  if (lang_value === '日文' || lang_value === '韓文') {
    return LANG_BUCKET_JP_KR;
  }
  if (
    lang_value === '台語' ||
    lang_value === '粵語' ||
    lang_value === '其他'
  ) {
    return LANG_BUCKET_OTHER;
  }
  return LANG_BUCKET_OTHER;
}

/**
 * @param {object} row
 */
export function resolve_language_bucket(row) {
  if (row_has_pure_instrumental_special(row)) {
    return {
      bucket: LANG_BUCKET_UNKNOWN_INSTRUMENTAL,
      language_tag: primary_language_tag_value(row),
      reason: 'special_type:純音樂',
    };
  }
  const lang = primary_language_tag_value(row);
  if (!lang || lang === '未確認') {
    return {
      bucket: LANG_BUCKET_UNKNOWN_INSTRUMENTAL,
      language_tag: lang || '未確認',
      reason: 'language_unconfirmed',
    };
  }
  return {
    bucket: language_value_to_bucket(lang),
    language_tag: lang,
    reason: 'language_tag',
  };
}

/**
 * @param {string} bucket
 * @param {string} genre_code
 */
export function mvp_lang_genre_playlist_id(bucket, genre_code) {
  return MVP_LANG_GENRE_PLAYLIST_ID_PREFIX + bucket + ':' + genre_code;
}

/**
 * @param {string} bucket
 * @param {string} genre_label_zh
 */
export function mvp_lang_genre_playlist_label_zh(bucket, genre_label_zh) {
  const lang_label = LANG_BUCKET_LABEL_ZH[bucket] || bucket;
  return lang_label + genre_label_zh;
}
