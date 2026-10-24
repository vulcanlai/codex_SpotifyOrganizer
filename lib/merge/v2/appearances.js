/**
 * appearances 指紋與去重（重複執行一致）
 */

/**
 * @param {object} appearance
 */
export function appearance_fingerprint(appearance) {
  const a = appearance || {};
  const parts = [
    a.kind || '',
    a.source || '',
    a.backup_type || '',
    a.playlist_id != null ? String(a.playlist_id) : '',
    a.album_id != null ? String(a.album_id) : '',
    a.position != null ? String(a.position) : '',
    a.disc_number != null ? String(a.disc_number) : '',
    a.track_number != null ? String(a.track_number) : '',
  ];
  return parts.join('|');
}

/**
 * @param {object[]} appearances
 * @param {object} candidate
 */
export function has_appearance(appearances, candidate) {
  const fp = appearance_fingerprint(candidate);
  for (let i = 0; i < appearances.length; i += 1) {
    if (appearance_fingerprint(appearances[i]) === fp) {
      return true;
    }
  }
  return false;
}

/**
 * @param {object[]} appearances
 * @param {object} candidate
 */
export function push_appearance_unique(appearances, candidate) {
  if (!has_appearance(appearances, candidate)) {
    appearances.push(candidate);
    return true;
  }
  return false;
}

/**
 * 深拷貝 appearance 陣列（保留 v1 內容）
 * @param {object[]} appearances
 */
export function clone_appearances(appearances) {
  if (!Array.isArray(appearances)) {
    return [];
  }
  const out = [];
  for (let i = 0; i < appearances.length; i += 1) {
    const a = appearances[i];
    out.push(JSON.parse(JSON.stringify(a)));
  }
  return out;
}
