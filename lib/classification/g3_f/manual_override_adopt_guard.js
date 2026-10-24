/**
 * manual-overrides 是否阻擋 G3-F 曲風採用（eligible／apply 共用）
 */

/**
 * @param {object|null} override_row
 * @param {string} dim
 */
export function is_manual_dimension_locked(override_row, dim) {
  if (!override_row || !Array.isArray(override_row.locked_dimensions)) {
    return false;
  }
  return override_row.locked_dimensions.indexOf(dim) >= 0;
}

/**
 * 是否阻擋 G3-F staged 曲風寫入／採用候選
 * 僅 playlist membership 或僅語言（未鎖曲風）不阻擋。
 * @param {object|null} override_row
 */
export function manual_override_blocks_g3_f_genre_adopt(override_row) {
  if (!override_row) {
    return false;
  }
  if (is_manual_dimension_locked(override_row, 'genre_profile')) {
    return true;
  }
  if (override_row.genre_profile) {
    return true;
  }
  if (Array.isArray(override_row.genres) && override_row.genres.length) {
    return true;
  }
  return false;
}
