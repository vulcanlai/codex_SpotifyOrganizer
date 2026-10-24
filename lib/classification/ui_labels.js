/**
 * 智慧分類 Web UI 顯示用繁體中文標籤（不改 API／儲存代碼）
 */
export {
  TIER_DISPLAY,
  TIER_DISPLAY_SHORT,
  FORMAL_STATE_DISPLAY,
  PREVIEW_MODE_DISPLAY,
  WRONG_DIMENSION_DISPLAY,
  format_confidence_tier,
  format_formal_state,
  format_preview_mode,
  localize_freeform_text,
} from './ui_display_localize.js';

export const DECADE_DISPLAY = {
  '1970s': '1970 年代',
  '1980s': '1980 年代',
  '1990s': '1990 年代',
  '2000s': '2000 年代',
  '2010s': '2010 年代',
  '2020s': '2020 年代',
  其他年代: '其他年代',
  年代未知: '年代未知',
};

export const DIMENSION_DISPLAY = {
  decade: '年代',
  language: '語言',
  genre: '曲風',
  context: '情境',
  special_type: '特殊類型',
};

export const CONFIDENCE_DISPLAY = {
  inferred: 'AI 推測',
  unknown: '資料不足',
  confirmed: '已人工確認',
};

export const REVIEW_STATUS_DISPLAY = {
  pending: '待審核',
  accepted: '已接受',
  rejected: '已拒絕',
  modified: '已修改',
};

export const METADATA_STATUS_DISPLAY = {
  complete: '歌曲資訊完整',
  metadata_missing: '歌曲資訊缺失',
};

/**
 * @param {string} decade_code
 */
export function format_decade_value(decade_code) {
  if (!decade_code) {
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(DECADE_DISPLAY, decade_code)) {
    return DECADE_DISPLAY[decade_code];
  }
  return decade_code;
}

/**
 * @param {string} dimension
 */
export function format_dimension_label(dimension) {
  if (!dimension) {
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(DIMENSION_DISPLAY, dimension)) {
    return DIMENSION_DISPLAY[dimension];
  }
  return dimension;
}

/**
 * @param {string} dimension
 * @param {string} value
 */
export function format_classification_value(dimension, value) {
  if (value == null || value === '') {
    return '';
  }
  if (dimension === 'decade') {
    return format_decade_value(value);
  }
  return value;
}

/**
 * @param {string} confidence
 * @param {{ is_manual_override?: boolean }} [opts]
 */
export function format_confidence_label(confidence, opts) {
  const options = opts || {};
  if (options.is_manual_override) {
    return '人工確認';
  }
  if (!confidence) {
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(CONFIDENCE_DISPLAY, confidence)) {
    return CONFIDENCE_DISPLAY[confidence];
  }
  return confidence;
}

/**
 * @param {string} status
 * @param {{ label?: string, candidate_version?: number }} [opts]
 */
export function format_review_status_label(status, opts) {
  const options = opts || {};
  if (
    (options.label === 'v2_pending' ||
      options.candidate_version === 2) &&
    status === 'pending'
  ) {
    return '新版待審核';
  }
  if (!status) {
    return REVIEW_STATUS_DISPLAY.pending;
  }
  if (Object.prototype.hasOwnProperty.call(REVIEW_STATUS_DISPLAY, status)) {
    return REVIEW_STATUS_DISPLAY[status];
  }
  return status;
}

/**
 * @param {string} status
 */
export function format_metadata_status_label(status) {
  if (!status) {
    return METADATA_STATUS_DISPLAY.metadata_missing;
  }
  if (Object.prototype.hasOwnProperty.call(METADATA_STATUS_DISPLAY, status)) {
    return METADATA_STATUS_DISPLAY[status];
  }
  return status;
}

/**
 * 顯示層去除連續或大小寫相同之重複藝人名（不修改 API 資料）
 * @param {string[]} artists
 * @returns {string[]}
 */
export function dedupe_display_artists(artists) {
  if (!artists || !artists.length) {
    return [];
  }
  const out = [];
  const seen = {};
  for (let i = 0; i < artists.length; i += 1) {
    const raw = artists[i];
    const name = raw == null ? '' : String(raw).replace(/^\s+|\s+$/g, '');
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen[key]) {
      continue;
    }
    seen[key] = true;
    out.push(name);
  }
  return out;
}

/**
 * @param {string[]} artists
 * @param {string} [separator]
 */
export function format_artists_display(artists, separator) {
  const sep = separator || '、';
  return dedupe_display_artists(artists).join(sep);
}

/**
 * 篩選下拉：顯示中文，value 仍用原始代碼
 * @param {string} dimension
 * @param {string} code
 * @param {number} [count]
 */
export function format_filter_option_text(dimension, code, count) {
  const label = format_classification_value(dimension, code);
  if (count == null) {
    return label;
  }
  return label + ' (' + count + ')';
}

/**
 * @param {{ value?: string, confidence?: string }} tag
 * @param {string} dimension
 */
export function format_tag_line(tag, dimension) {
  const dim = format_dimension_label(dimension || tag.dimension);
  const val = format_classification_value(tag.dimension || dimension, tag.value);
  const conf = format_confidence_label(tag.confidence, {
    is_manual_override: tag.is_manual_override,
  });
  return dim + '：' + val + '（' + conf + '）';
}
