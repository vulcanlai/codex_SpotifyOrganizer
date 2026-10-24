/**
 * MVP 智慧歌單 Spotify 標題與描述（本機規則）
 */
import { MAIN_GENRES } from './genre_taxonomy.js';
import { EMOTIONS_BY_CODE } from './g3_emotion/emotion_taxonomy.js';
import {
  LANG_BUCKET_OTHER,
  LANG_BUCKET_UNKNOWN_INSTRUMENTAL,
} from './mvp_language_buckets.js';

export const MVP_SPOTIFY_PLAYLIST_NAME_PREFIX = '🎵 ';

/**
 * 全形「／」→半形「 / 」；已為「 / 」者不重複加空格
 * @param {string} full_name
 */
export function mvp_spotify_normalize_slash_in_display_name(full_name) {
  if (typeof full_name !== 'string' || full_name.length === 0) {
    return full_name;
  }
  let s = full_name.split('／').join(' / ');
  s = s.replace(/\s*\/\s*/g, ' / ');
  while (s.indexOf('  ') >= 0) {
    s = s.replace(/  +/g, ' ');
  }
  return s;
}

/**
 * @param {string} body - 不含「🎵 」前綴的標題本體
 */
function mvp_spotify_format_display_name(body) {
  const text = typeof body === 'string' ? body : '';
  return mvp_spotify_normalize_slash_in_display_name(
    MVP_SPOTIFY_PLAYLIST_NAME_PREFIX + text
  );
}

/**
 * @param {string} code
 */
export function mvp_main_genre_label_zh(code) {
  for (let i = 0; i < MAIN_GENRES.length; i += 1) {
    if (MAIN_GENRES[i].code === code) {
      return MAIN_GENRES[i].label_zh;
    }
  }
  return code || '';
}

/**
 * other_lang、unknown_or_instrumental 專用曲風標題
 * @param {string} genre_label_zh
 */
export function mvp_spotify_genre_title_for_special_buckets(genre_label_zh) {
  if (typeof genre_label_zh !== 'string' || genre_label_zh.length === 0) {
    return '';
  }
  if (genre_label_zh.indexOf('音樂') !== -1) {
    return genre_label_zh;
  }
  if (/^[\u4e00-\u9fff]{2}$/.test(genre_label_zh)) {
    return genre_label_zh + '音樂';
  }
  return genre_label_zh;
}

/**
 * catalog label_zh 常含尾綴「音樂」；Spotify 標題用較短形式（例：華語流行）
 * @param {string} label_zh
 */
export function mvp_spotify_title_from_catalog_label(label_zh) {
  if (typeof label_zh !== 'string' || label_zh.length === 0) {
    return '';
  }
  if (label_zh.length >= 2 && label_zh.slice(-2) === '音樂') {
    return label_zh.slice(0, -2);
  }
  return label_zh;
}

/**
 * 情緒歌單 Spotify 標題（中間點改斜線分隔）
 * @param {string} emotion_code
 */
export function mvp_spotify_emotion_title_zh(emotion_code) {
  const em = EMOTIONS_BY_CODE[emotion_code];
  const label = em ? em.label_zh : emotion_code || '';
  return label.replace(/・/g, ' / ');
}

/**
 * @param {object} pl
 */
export function spotify_playlist_display_name(pl) {
  if (pl.kind === 'language_genre') {
    if (pl.language_bucket === LANG_BUCKET_OTHER) {
      const genre = mvp_spotify_genre_title_for_special_buckets(
        mvp_main_genre_label_zh(pl.primary_genre)
      );
      return mvp_spotify_format_display_name(genre);
    }
    if (pl.language_bucket === LANG_BUCKET_UNKNOWN_INSTRUMENTAL) {
      const genre = mvp_spotify_genre_title_for_special_buckets(
        mvp_main_genre_label_zh(pl.primary_genre)
      );
      return mvp_spotify_format_display_name(genre + ' / 其他');
    }
    if (pl.label_zh) {
      return mvp_spotify_format_display_name(
        mvp_spotify_title_from_catalog_label(pl.label_zh)
      );
    }
    return mvp_spotify_format_display_name(mvp_main_genre_label_zh(pl.primary_genre));
  }
  if (pl.kind === 'genre') {
    if (pl.label_zh) {
      return mvp_spotify_format_display_name(
        mvp_spotify_title_from_catalog_label(pl.label_zh)
      );
    }
    return mvp_spotify_format_display_name(mvp_main_genre_label_zh(pl.primary_genre));
  }
  if (pl.kind === 'emotion_tentative') {
    return mvp_spotify_format_display_name(
      mvp_spotify_emotion_title_zh(pl.emotion_code)
    );
  }
  const short =
    mvp_spotify_title_from_catalog_label(pl.label_zh) || pl.playlist_id || '';
  return mvp_spotify_format_display_name(short);
}

/**
 * @param {object} pl
 */
export function mvp_sync_playlist_description_zh(pl) {
  if (pl.kind === 'emotion_tentative') {
    const em = EMOTIONS_BY_CODE[pl.emotion_code];
    const label = em ? em.label_zh : pl.emotion_code || '情緒';
    const def = em && em.definition_zh ? em.definition_zh : '';
    return (
      '暫定情緒・參考（' +
      label +
      '）：由本機情境標籤映射，非已驗證情緒分析。' +
      def +
      ' SpotifyOrganizer MVP。'
    );
  }
  if (pl.kind === 'language_genre' && pl.language_bucket === LANG_BUCKET_OTHER) {
    return (
      '語言分類：其他語言（含台語、粵語、其他等 language tag）。曲風：' +
      mvp_main_genre_label_zh(pl.primary_genre) +
      '。依 classification-index。SpotifyOrganizer MVP。'
    );
  }
  if (
    pl.kind === 'language_genre' &&
    pl.language_bucket === LANG_BUCKET_UNKNOWN_INSTRUMENTAL
  ) {
    return (
      '語言分類：語言 tag 未確認、special 純音樂，或尚未標語言之曲目（並非全部為純音樂）。曲風：' +
      mvp_main_genre_label_zh(pl.primary_genre) +
      '。依 classification-index。SpotifyOrganizer MVP。'
    );
  }
  return '依本機語言 tag × 曲風（classification-index）。SpotifyOrganizer MVP。';
}
