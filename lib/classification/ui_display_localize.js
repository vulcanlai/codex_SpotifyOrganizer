/**
 * 顯示層中文化（不修改儲存代碼或 AI 原始 JSON）
 */
import {
  SUBGENRES_BY_CODE,
  main_genre_label_zh,
  subgenre_label_zh,
  GENRE_PRIMARY_UNKNOWN,
} from './genre_taxonomy.js';

export const TIER_DISPLAY = {
  high: '高可信度',
  medium: '中可信度',
  low: '低可信度',
};

/** 簡短版（品質驗證等區塊標題） */
export const TIER_DISPLAY_SHORT = {
  high: '高',
  medium: '中',
  low: '低',
};

export const FORMAL_STATE_DISPLAY = {
  confirmed: '已人工確認',
  ai_suggested: 'AI 建議分類',
  rejected: '已拒絕',
  unknown: '尚未分類',
};

export const PREVIEW_MODE_DISPLAY = {
  strict: '嚴格（僅人工確認）',
  balanced: '平衡（預設）',
  relaxed: '寬鬆（標示未確認風險）',
};

export const WRONG_DIMENSION_DISPLAY = {
  primary_genre: '主曲風',
  secondary_genre: '次要曲風',
  subgenre: '子曲風',
  language: '語言',
  context: '情境',
  special_type: '特殊標籤',
};

const PHRASE_REPLACEMENTS = [
  ['mainstream mandopop', '主流華語流行'],
  ['Mainstream mandopop', '主流華語流行'],
  ['contemporary R&B／pop', '當代 R&B／流行'],
  ['contemporary R&B/pop', '當代 R&B／流行'],
  ['contemporary R&B', '當代 R&B'],
  ['Contemporary R&B', '當代 R&B'],
  ['metadata 未完整', '歌曲基本資料未完整'],
  ['metadata', '歌曲基本資料'],
  ['Metadata', '歌曲基本資料'],
  ['待 enrich 或人工听音', '待補齊歌曲資訊或經人工聆聽確認'],
  ['待 enrich 或人工聽音', '待補齊歌曲資訊或經人工聆聽確認'],
  ['待 enrich', '待補齊歌曲資訊'],
  ['enrichment', '補齊歌曲資訊'],
  ['enrich', '補齊歌曲資訊'],
  ['mandopop', '華語流行'],
  ['AI confidence 為 unknown', 'AI 標記為資料不足'],
  ['AI 標記為 unknown', 'AI 標記為未確認'],
  ['主曲風為未確認（AI 標記 unknown）', '目前無法確認主曲風'],
  ['主曲風保留 unknown', '主曲風尚缺可靠依據'],
  ['規則推導可信度為 low', '系統評估為低可信度'],
  ['confidence 為 unknown', '可信度標記為資料不足'],
  ['primary=unknown', '主曲風＝未確認'],
  ['primary genre', '主曲風'],
  ['secondary genre', '次要曲風'],
  ['subgenre', '子曲風'],
];

const WORD_REPLACEMENTS = [
  [/\bunknown\b/gi, '未確認'],
  [/\binferred\b/gi, 'AI 推測'],
  [/\bconfirmed\b/gi, '已確認'],
  [/\bpending\b/gi, '待審核'],
  [/\baccepted\b/gi, '已接受'],
  [/\brejected\b/gi, '已拒絕'],
  [/\bhigh\b/gi, '高'],
  [/\bmedium\b/gi, '中'],
  [/\blow\b/gi, '低'],
];

function escape_regexp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sorted_subgenre_codes(taxonomy) {
  const keys =
    taxonomy && taxonomy.subgenres
      ? Object.keys(taxonomy.subgenres)
      : Object.keys(SUBGENRES_BY_CODE);
  return keys.slice().sort(function (a, b) {
    return b.length - a.length;
  });
}

function sorted_main_genre_codes(taxonomy) {
  const codes = [];
  if (taxonomy && taxonomy.main_genres) {
    for (let i = 0; i < taxonomy.main_genres.length; i += 1) {
      codes.push(taxonomy.main_genres[i].code);
    }
  } else {
    codes.push(
      'soundtrack_instrumental',
      'country_blues',
      'metal_punk',
      'reggae_world',
      'rnb_soul',
      'hip_hop',
      'electronic',
      'classical',
      'folk',
      'jazz',
      'rock',
      'pop'
    );
  }
  return codes.sort(function (a, b) {
    return b.length - a.length;
  });
}

function label_for_sub(code, taxonomy) {
  if (taxonomy && taxonomy.subgenres && taxonomy.subgenres[code]) {
    return taxonomy.subgenres[code].label_zh;
  }
  return subgenre_label_zh(code);
}

function label_for_main(code, taxonomy) {
  if (code === GENRE_PRIMARY_UNKNOWN) {
    return '未確認';
  }
  if (taxonomy && taxonomy.main_genres) {
    for (let i = 0; i < taxonomy.main_genres.length; i += 1) {
      if (taxonomy.main_genres[i].code === code) {
        return taxonomy.main_genres[i].label_zh;
      }
    }
  }
  return main_genre_label_zh(code);
}

/**
 * @param {string} tier
 * @param {{ short?: boolean }} [opts]
 */
export function format_confidence_tier(tier, opts) {
  const options = opts || {};
  const map = options.short ? TIER_DISPLAY_SHORT : TIER_DISPLAY;
  if (!tier) {
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(map, tier)) {
    return map[tier];
  }
  return tier;
}

/**
 * @param {string} state
 */
export function format_formal_state(state) {
  if (!state) {
    return FORMAL_STATE_DISPLAY.unknown;
  }
  if (Object.prototype.hasOwnProperty.call(FORMAL_STATE_DISPLAY, state)) {
    return FORMAL_STATE_DISPLAY[state];
  }
  return state;
}

/**
 * @param {string} mode
 */
export function format_preview_mode(mode) {
  if (!mode) {
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(PREVIEW_MODE_DISPLAY, mode)) {
    return PREVIEW_MODE_DISPLAY[mode];
  }
  return mode;
}

/**
 * 安全中文化：只替換已知代碼／片語，保留歌名與專有名詞
 * @param {string} text
 * @param {object} [taxonomy] API / genre_taxonomy 匯出結構
 */
export function localize_freeform_text(text, taxonomy) {
  if (text == null || text === '') {
    return '';
  }
  let out = String(text);

  for (let p = 0; p < PHRASE_REPLACEMENTS.length; p += 1) {
    const pair = PHRASE_REPLACEMENTS[p];
    out = out.split(pair[0]).join(pair[1]);
  }

  const sub_codes = sorted_subgenre_codes(taxonomy);
  for (let s = 0; s < sub_codes.length; s += 1) {
    const code = sub_codes[s];
    const label = label_for_sub(code, taxonomy);
    if (label && label !== code) {
      out = out.split(code).join(label);
    }
  }

  const main_codes = sorted_main_genre_codes(taxonomy);
  for (let m = 0; m < main_codes.length; m += 1) {
    const code = main_codes[m];
    const label = label_for_main(code, taxonomy);
    const re = new RegExp('\\b' + escape_regexp(code) + '\\b', 'g');
    out = out.replace(re, label);
  }

  for (let w = 0; w < WORD_REPLACEMENTS.length; w += 1) {
    out = out.replace(WORD_REPLACEMENTS[w][0], WORD_REPLACEMENTS[w][1]);
  }

  return out;
}
