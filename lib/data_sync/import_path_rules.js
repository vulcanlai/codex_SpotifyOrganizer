/**
 * 匯入 ZIP 成員路徑白名單與 Windows 檔名安全
 */
import { should_exclude_relative_path } from './export_profile_minimal.js';

const WIN_INVALID = /[<>:"|?*\x00-\x1f]/;
const DRIVE_PATH = /^[a-zA-Z]:[\\/]/;
const UNC_PATH = /^\\\\/;

/**
 * @param {string} rel
 * @returns {{ ok: true, normalized: string } | { ok: false, reason_zh: string }}
 */
export function normalize_and_validate_import_member_path(rel) {
  if (typeof rel !== 'string' || !rel.trim()) {
    return { ok: false, reason_zh: '空的成員路徑' };
  }
  let p = rel.replace(/\\/g, '/').trim();
  if (p.startsWith('/')) {
    return { ok: false, reason_zh: '拒絕絕對路徑成員：' + rel };
  }
  if (DRIVE_PATH.test(p) || UNC_PATH.test(p)) {
    return { ok: false, reason_zh: '拒絕磁碟機或 UNC 路徑：' + rel };
  }
  if (p.indexOf('..') >= 0) {
    return { ok: false, reason_zh: '拒絕路徑穿越：' + rel };
  }

  const parts = p.split('/');
  for (let i = 0; i < parts.length; i += 1) {
    const seg = parts[i];
    if (!seg || seg === '.' || seg === '..') {
      return { ok: false, reason_zh: '非法路徑片段：' + rel };
    }
    if (WIN_INVALID.test(seg)) {
      return { ok: false, reason_zh: '非法 Windows 檔名字元：' + rel };
    }
  }

  if (p === 'export-manifest.json') {
    return { ok: true, normalized: p };
  }

  if (should_exclude_relative_path(p)) {
    return { ok: false, reason_zh: '成員不在 minimal 白名單：' + p };
  }

  return { ok: true, normalized: p };
}

/**
 * @param {string[]} normalized_paths
 */
export function detect_case_insensitive_path_collisions(normalized_paths) {
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (let i = 0; i < normalized_paths.length; i += 1) {
    const p = normalized_paths[i];
    const key = p.toLowerCase();
    if (seen.has(key) && seen.get(key) !== p) {
      return {
        ok: false,
        reason_zh:
          'ZIP 內大小寫衝突路徑：' + seen.get(key) + ' 與 ' + p,
      };
    }
    seen.set(key, p);
  }
  return { ok: true };
}
