/**
 * 解壓前 ZIP 成員路徑檢查
 */
import {
  detect_case_insensitive_path_collisions,
  normalize_and_validate_import_member_path,
} from './import_path_rules.js';

/**
 * @param {{ path: string }[]} zip_entries
 */
export function validate_zip_member_paths_before_extract(zip_entries) {
  /** @type {string[]} */
  const normalized = [];
  for (let i = 0; i < zip_entries.length; i += 1) {
    const p = zip_entries[i].path.replace(/\\/g, '/');
    const check = normalize_and_validate_import_member_path(p);
    if (!check.ok) {
      return check;
    }
    normalized.push(check.normalized);
  }
  const collision = detect_case_insensitive_path_collisions(normalized);
  if (!collision.ok) {
    return collision;
  }
  return { ok: true, paths: normalized };
}

/**
 * @param {{ path: string }[]} zip_entries
 * @param {object} manifest
 */
export function zip_listing_matches_manifest_files(zip_entries, manifest) {
  const zip_set = new Set(
    zip_entries.map(function (e) {
      return e.path.replace(/\\/g, '/');
    })
  );
  const expected = new Set(['export-manifest.json']);
  for (let i = 0; i < manifest.files.length; i += 1) {
    expected.add(manifest.files[i].path);
  }
  if (zip_set.size !== expected.size) {
    return {
      ok: false,
      reason_zh:
        'ZIP 成員數與 manifest 不一致（zip=' +
        zip_set.size +
        ' expected=' +
        expected.size +
        '）',
    };
  }
  for (const p of expected) {
    if (!zip_set.has(p)) {
      return { ok: false, reason_zh: 'ZIP 缺少成員：' + p };
    }
  }
  return { ok: true };
}
