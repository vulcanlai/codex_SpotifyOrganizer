/**
 * 單曲自動分類（本階段不推測語言／曲風／情境）
 */
import {
  DIMENSION_LANGUAGE,
  DIMENSION_GENRE,
  DIMENSION_CONTEXT,
  DIMENSION_SPECIAL,
  CONFIDENCE_UNKNOWN,
  CONFIDENCE_CONFIRMED,
} from './dimensions.js';
import { classify_decade_tag } from './decade.js';

function unknown_tag(dimension, value, evidence) {
  return {
    dimension,
    value,
    source: 'classification_rules_v1',
    method: 'default_unknown',
    confidence: CONFIDENCE_UNKNOWN,
    evidence,
    is_manual_override: false,
  };
}

/**
 * @param {object} merged_record
 */
export function classify_track_auto(merged_record) {
  /** @type {object[]} */
  const tags = [];
  tags.push(classify_decade_tag(merged_record));

  tags.push(
    unknown_tag(
      DIMENSION_LANGUAGE,
      '未確認',
      '本階段未使用歌名或藝人國籍推測語言。'
    )
  );
  tags.push(
    unknown_tag(
      DIMENSION_GENRE,
      '未確認',
      '本階段未建立自動曲風推測規則。'
    )
  );

  const apps = merged_record.appearances || [];
  let has_saved_album = false;
  for (let i = 0; i < apps.length; i += 1) {
    if (apps[i] && apps[i].kind === 'saved_album') {
      has_saved_album = true;
      break;
    }
  }
  if (has_saved_album) {
    tags.push({
      dimension: DIMENSION_SPECIAL,
      value: '完整專輯收藏',
      source: 'library-v2:appearances',
      method: 'saved_album_appearance',
      confidence: CONFIDENCE_CONFIRMED,
      evidence:
        '曲目出現在 saved_album 來源關係（使用者收藏專輯曲目），可視為完整專輯收藏來源。',
      is_manual_override: false,
    });
  } else {
    tags.push(
      unknown_tag(
        DIMENSION_SPECIAL,
        '未確認',
        '無 saved_album 來源或其他明確特殊類型依據。'
      )
    );
  }

  return tags;
}

/**
 * 情境：本階段不自動指定（僅能由人工覆寫加入）
 * @returns {object[]}
 */
export function empty_context_tags() {
  return [];
}
