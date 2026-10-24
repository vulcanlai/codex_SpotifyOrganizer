/**
 * 主曲風與子曲風合法對應（唯讀檢查）
 */
import { SUBGENRES_BY_CODE, GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';

/**
 * @param {string} primary
 * @param {string[]} subgenres
 */
export function validate_primary_subgenres(primary, subgenres) {
  const subs = subgenres || [];
  if (primary === GENRE_PRIMARY_UNKNOWN) {
    return { ok: true, violations: [] };
  }
  /** @type {object[]} */
  const violations = [];
  for (let i = 0; i < subs.length; i += 1) {
    const code = subs[i];
    const row = SUBGENRES_BY_CODE[code];
    if (!row) {
      violations.push({ subgenre: code, reason: 'unknown_subgenre_code' });
      continue;
    }
    if (row.main !== primary) {
      violations.push({
        subgenre: code,
        expected_primary: row.main,
        actual_primary: primary,
        reason: 'subgenre_main_mismatch',
      });
    }
  }
  return { ok: violations.length === 0, violations: violations };
}
