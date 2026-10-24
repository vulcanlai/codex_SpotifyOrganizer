/**
 * 主曲風（12）與子曲風（40）字典
 */

export const GENRE_PRIMARY_UNKNOWN = 'unknown';

export const MAIN_GENRES = [
  {
    code: 'pop',
    label_zh: '流行',
    definition: '以旋律與主流編曲為核心的流行音樂，不含特定子類型時使用。',
  },
  {
    code: 'rock',
    label_zh: '搖滾',
    definition: '以吉他、鼓與搖滾編制為核心的曲風總稱。',
  },
  {
    code: 'electronic',
    label_zh: '電子',
    definition: '以合成器、取樣與電子製作為核心的音樂。',
  },
  {
    code: 'rnb_soul',
    label_zh: 'R&B／靈魂樂',
    definition: '節奏藍調、靈魂與放克相關的 R&B 系譜。',
  },
  {
    code: 'hip_hop',
    label_zh: '嘻哈',
    definition: '饒舌、嘻哈節奏與相關文化脈絡的音樂。',
  },
  {
    code: 'folk',
    label_zh: '民謠',
    definition: '民謠、都會民謠與民謠搖滾等以歌詞敘事為主的曲風。',
  },
  {
    code: 'jazz',
    label_zh: '爵士',
    definition: '爵士和聲、即興與爵士編制相關曲風。',
  },
  {
    code: 'classical',
    label_zh: '古典',
    definition: '古典與嚴肅音樂傳統，含管弦、室內樂與鋼琴獨奏等。',
  },
  {
    code: 'country_blues',
    label_zh: '鄉村／藍調',
    definition: '鄉村音樂與藍調及其融合類型。',
  },
  {
    code: 'metal_punk',
    label_zh: '金屬／龐克',
    definition: '重金屬、龐克與高失真搖滾相關曲風。',
  },
  {
    code: 'reggae_world',
    label_zh: '雷鬼／世界音樂',
    definition: '雷鬼、拉丁與世界民俗等跨地域曲風。',
  },
  {
    code: 'soundtrack_instrumental',
    label_zh: '配樂／器樂',
    definition: '影視、遊戲配樂與以器樂／環境為主的類型（可與其他主曲風並存）。',
  },
];

/** @type {Record<string, { code: string, main: string, label_zh: string, definition: string }>} */
export const SUBGENRES_BY_CODE = {};

function add_sub(main, code, label_zh, definition) {
  SUBGENRES_BY_CODE[code] = { code, main, label_zh, definition };
}

add_sub('pop', 'pop_ballad', '抒情流行', '慢板、以情感演唱為主的流行歌曲。');
add_sub('pop', 'dance_pop', '舞曲流行', '具明顯舞曲節拍的流行音樂。');
add_sub('pop', 'synth_pop', '合成器流行', '以合成器音色為特色的流行音樂。');
add_sub('pop', 'indie_pop', '獨立流行', '獨立製作或另類製作思維的流行音樂。');
add_sub('pop', 'adult_contemporary', '成人當代', '成人當代流行，偏成熟聽眾市場。');

add_sub('rock', 'classic_rock', '經典搖滾', '1970–1980 年代經典搖滾風格。');
add_sub('rock', 'pop_rock', '流行搖滾', '流行旋律與搖滾編制結合。');
add_sub('rock', 'alternative_rock', '另類搖滾', '另類／獨立搖滾取向。');
add_sub('rock', 'hard_rock', '硬式搖滾', '更重、更強的搖滾失真與力度。');

add_sub('electronic', 'electropop', '電子流行', '電子製作與流行結構結合。');
add_sub('electronic', 'house', '浩室', 'House 節拍與俱樂部舞曲傳統。');
add_sub('electronic', 'trance', '出神', 'Trance 與長線條電子舞曲。');
add_sub('electronic', 'ambient_electronic', '氛圍電子', '偏氛圍、空間感的電子音樂。');

add_sub('rnb_soul', 'contemporary_rnb', '當代 R&B', '當代節奏藍調與主流 R&B。');
add_sub('rnb_soul', 'classic_soul', '經典靈魂樂', '1960–1970 年代靈魂樂傳統。');
add_sub('rnb_soul', 'neo_soul', '新靈魂', '1990 年代後新靈魂運動相關。');
add_sub('rnb_soul', 'funk', '放克', '強調 Groove 與放克節奏。');

add_sub('hip_hop', 'old_school_hip_hop', '老派嘻哈', '早期嘻哈與老派饒舌風格。');
add_sub('hip_hop', 'pop_rap', '流行饒舌', '饒舌與流行旋律結合。');
add_sub('hip_hop', 'trap', '陷阱', 'Trap 節拍與相關製作。');

add_sub('folk', 'folk_pop', '民謠流行', '民謠與流行結合。');
add_sub('folk', 'urban_folk', '都會民謠', '都會題材與民謠敘事。');
add_sub('folk', 'folk_rock', '民謠搖滾', '民謠與搖滾編制結合。');

add_sub('jazz', 'jazz_pop', '爵士流行', '爵士元素與流行結合。');
add_sub('jazz', 'smooth_jazz', '輕爵士', '較平滑、易聽的爵士流行化。');
add_sub('jazz', 'swing_jazz', '搖擺爵士', '搖擺節奏與大樂團傳統。');

add_sub('classical', 'orchestral', '管弦樂', '管弦樂編制與交響作品。');
add_sub('classical', 'solo_piano', '鋼琴獨奏', '鋼琴獨奏古典或現代古典。');
add_sub('classical', 'chamber_music', '室內樂', '小編制室內樂作品。');

add_sub('country_blues', 'country_pop', '鄉村流行', '鄉村與流行結合。');
add_sub('country_blues', 'traditional_country', '傳統鄉村', '傳統鄉村音樂。');
add_sub('country_blues', 'blues_rock', '藍調搖滾', '藍調與搖滾融合。');

add_sub('metal_punk', 'heavy_metal', '重金屬', '重金屬與高失真吉他。');
add_sub('metal_punk', 'punk_rock', '龐克搖滾', '龐克搖滾與快速、直接風格。');

add_sub('reggae_world', 'reggae', '雷鬼', '雷鬼節拍與加勒比傳統。');
add_sub('reggae_world', 'latin_pop', '拉丁流行', '拉丁元素與流行結合。');
add_sub('reggae_world', 'world_folk', '世界民俗', '世界各地民俗與傳統音樂。');

add_sub('soundtrack_instrumental', 'film_score', '電影配樂', '電影或影集配樂（可同時具其他主曲風）。');
add_sub('soundtrack_instrumental', 'game_score', '遊戲配樂', '遊戲配樂與互動媒體音樂。');
add_sub(
  'soundtrack_instrumental',
  'ambient_instrumental',
  '環境器樂',
  '偏環境、無主唱的器樂作品。'
);

export const MAIN_GENRE_CODES = MAIN_GENRES.map(function (g) {
  return g.code;
});

export const SUBGENRE_CODES = Object.keys(SUBGENRES_BY_CODE);

export function is_main_genre_code(code) {
  return code === GENRE_PRIMARY_UNKNOWN || MAIN_GENRE_CODES.indexOf(code) >= 0;
}

export function main_genre_label_zh(code) {
  if (code === GENRE_PRIMARY_UNKNOWN) {
    return '未確認';
  }
  for (let i = 0; i < MAIN_GENRES.length; i += 1) {
    if (MAIN_GENRES[i].code === code) {
      return MAIN_GENRES[i].label_zh;
    }
  }
  return code;
}

export function subgenre_label_zh(code) {
  const row = SUBGENRES_BY_CODE[code];
  return row ? row.label_zh : code;
}

export function subgenres_for_main(main_code) {
  const out = [];
  const keys = Object.keys(SUBGENRES_BY_CODE);
  for (let i = 0; i < keys.length; i += 1) {
    const row = SUBGENRES_BY_CODE[keys[i]];
    if (row.main === main_code) {
      out.push(row);
    }
  }
  return out;
}

export function taxonomy_export_for_ui() {
  return {
    main_genres: MAIN_GENRES,
    subgenres: SUBGENRES_BY_CODE,
    primary_unknown: GENRE_PRIMARY_UNKNOWN,
  };
}
