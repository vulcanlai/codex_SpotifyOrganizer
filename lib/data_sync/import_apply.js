/**
 * 正式寫入 minimal 允許路徑（不含 export-manifest.json）
 */
import fs from 'node:fs';
import path from 'node:path';
import { hash_file_sha256_sync } from './file_hash.js';
import { lstat_is_reparse_or_symlink } from './path_guard.js';

/**
 * @param {string} extract_root
 * @param {string} project_root
 * @param {object} manifest
 */
export function apply_import_files_from_extract(extract_root, project_root, manifest) {
  for (let i = 0; i < manifest.files.length; i += 1) {
    const rel = manifest.files[i].path;
    const src = path.join(extract_root, rel.split('/').join(path.sep));
    const dest = path.join(project_root, rel.split('/').join(path.sep));
    if (lstat_is_reparse_or_symlink(src)) {
      return { ok: false, reason_zh: '拒絕套用 symlink 來源：' + rel };
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  return { ok: true };
}

/**
 * @param {string} project_root
 * @param {object} manifest
 */
export function verify_applied_files_match_manifest(project_root, manifest) {
  for (let i = 0; i < manifest.files.length; i += 1) {
    const f = manifest.files[i];
    const abs = path.join(project_root, f.path.split('/').join(path.sep));
    if (!fs.existsSync(abs)) {
      return { ok: false, reason_zh: '匯入後缺少檔案：' + f.path };
    }
    const h = hash_file_sha256_sync(abs);
    if (h.sha256 !== f.sha256 || h.size !== f.size) {
      return {
        ok: false,
        reason_zh: '匯入後 SHA-256 不符：' + f.path,
      };
    }
  }
  return { ok: true };
}
