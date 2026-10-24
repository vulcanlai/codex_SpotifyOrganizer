/**
 * 發行版本年代（非首次發表年份）
 */
import { is_weak_metadata_value } from '../merge/v2/metadata_merge.js';
import {
  DIMENSION_DECADE,
  CONFIDENCE_INFERRED,
} from './dimensions.js';

/**
 * @param {string|null|undefined} release_date
 */
export function parse_release_year(release_date) {
  if (is_weak_metadata_value(release_date)) {
    return null;
  }
  const s = String(release_date).trim();
  const m = s.match(/^(\d{4})/);
  if (!m) {
    return null;
  }
  const year = parseInt(m[1], 10);
  return Number.isFinite(year) ? year : null;
}

/**
 * @param {number} year
 */
export function decade_value_from_year(year) {
  if (year >= 1970 && year <= 1979) {
    return '1970s';
  }
  if (year >= 1980 && year <= 1989) {
    return '1980s';
  }
  if (year >= 1990 && year <= 1999) {
    return '1990s';
  }
  if (year >= 2000 && year <= 2009) {
    return '2000s';
  }
  if (year >= 2010 && year <= 2019) {
    return '2010s';
  }
  if (year >= 2020 && year <= 2029) {
    return '2020s';
  }
  return '其他年代';
}

/**
 * @param {object} merged_record
 */
export function classify_decade_tag(merged_record) {
  const meta = merged_record.merged_metadata || {};
  const year = parse_release_year(meta.release_date);
  if (year == null) {
    return {
      dimension: DIMENSION_DECADE,
      value: '年代未知',
      source: 'merged_metadata',
      method: 'release_date_missing',
      confidence: 'unknown',
      evidence: '缺少有效發行日期，無法判定版本發行年代。',
      is_manual_override: false,
    };
  }
  const value = decade_value_from_year(year);
  const precision = meta.release_date_precision || 'unknown';
  return {
    dimension: DIMENSION_DECADE,
    value,
    source: 'merged_metadata',
    method: 'release_date_version_year',
    confidence: CONFIDENCE_INFERRED,
    evidence:
      `依專輯／曲目發行日期 ${meta.release_date}（precision=${precision}）判定為「版本發行年代」${value}，不代表歌曲首次發表年份。`,
    is_manual_override: false,
    release_date_precision: precision,
  };
}
