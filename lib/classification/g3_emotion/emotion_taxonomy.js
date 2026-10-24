/**
 * G3 情緒分類詞表（與曲風、context／moods 情境維度分離）
 */

export const EMOTION_CODES = [
  'melancholy_sad',
  'relaxed_comfort',
  'upbeat_joy',
  'energetic_passion',
  'romantic_tender',
  'late_night_calm',
];

/** @type {Record<string, { code: string, label_zh: string, definition_zh: string }>} */
export const EMOTIONS_BY_CODE = {
  melancholy_sad: {
    code: 'melancholy_sad',
    label_zh: '悲傷・傷感',
    definition_zh: '整體聽感或歌詞指向哀傷、失落、感傷；須有證據軸支撐，不可僅凭歌名推斷。',
  },
  relaxed_comfort: {
    code: 'relaxed_comfort',
    label_zh: '輕鬆・舒服',
    definition_zh: '聽感偏柔和、無壓或舒適；須區分「使用情境放鬆」與本標籤的聽感描述。',
  },
  upbeat_joy: {
    code: 'upbeat_joy',
    label_zh: '輕快・愉悅',
    definition_zh: '聽感或歌詞偏明亮、愉悅；不可僅因歌手形象或曲風流行即標記。',
  },
  energetic_passion: {
    code: 'energetic_passion',
    label_zh: '熱血・動感',
    definition_zh: '能量感、動感或激昂；不可由曲長或 explicit 推論。',
  },
  romantic_tender: {
    code: 'romantic_tender',
    label_zh: '浪漫・深情',
    definition_zh: '浪漫或深情取向；歌名含「愛」等仍屬弱線索，須標記 unverified。',
  },
  late_night_calm: {
    code: 'late_night_calm',
    label_zh: '深夜・沉靜',
    definition_zh: '沉靜、內斂或適合深夜聆聽的聽感；不可與 context「睡前」混為一談。',
  },
};

export const EMOTION_DIMENSION = 'emotion';

export const EMOTION_TAXONOMY_VERSION = 1;

/**
 * @param {string} code
 */
export function is_emotion_code(code) {
  return typeof code === 'string' && EMOTION_CODES.indexOf(code) >= 0;
}

/**
 * @param {string} code
 */
export function emotion_label_zh(code) {
  const row = EMOTIONS_BY_CODE[code];
  return row ? row.label_zh : code;
}
