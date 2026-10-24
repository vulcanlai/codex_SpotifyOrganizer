/**
 * G3-E.2 批次品質檢查
 */
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';

function has_pure(row) {
  const specs = row.special_types || [];
  for (let i = 0; i < specs.length; i += 1) {
    if ((specs[i].value || specs[i]) === '純音樂') {
      return true;
    }
  }
  return false;
}

/**
 * @param {object[]} rows
 * @param {string} batch_id
 * @param {{ expect_soundtrack_heavy?: boolean }} [opts]
 */
export function run_g3_e2_batch_quality(rows, batch_id, opts) {
  const options = opts || {};
  const n = rows.length;
  let unknown_pk = 0;
  let soundtrack = 0;
  let pure_tag = 0;
  let dup_reason = 0;
  const seen = {};

  for (let i = 0; i < n; i += 1) {
    const row = rows[i];
    const pk = row.genre_profile.primary_genre;
    if (pk === 'unknown' || pk === GENRE_PRIMARY_UNKNOWN) {
      unknown_pk += 1;
    }
    if (pk === 'soundtrack_instrumental') {
      soundtrack += 1;
    }
    if (has_pure(row)) {
      pure_tag += 1;
    }
    const rz = row.reason_zh || '';
    if (rz && seen[rz]) {
      dup_reason += 1;
    }
    seen[rz] = true;
  }

  const flags = [];
  if (n && unknown_pk / n > 0.5) {
    flags.push('unknown 主曲風比例過高');
  }
  if (n && soundtrack / n > 0.7 && !options.expect_soundtrack_heavy) {
    flags.push('soundtrack 比例過高');
  }
  if (dup_reason > 0) {
    flags.push('reason_zh 重複');
  }

  return {
    batch_id: batch_id,
    track_count: n,
    unknown_primary_ratio: n ? unknown_pk / n : 0,
    soundtrack_ratio: n ? soundtrack / n : 0,
    pure_instrumental_tag_count: pure_tag,
    duplicate_reason_count: dup_reason,
    systemic_flags_zh: flags,
    pass: flags.length === 0,
  };
}
