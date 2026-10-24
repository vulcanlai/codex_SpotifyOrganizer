/**
 * 自 ZIP 解出後以 SHA-256 驗證與 manifest 一致（非只比對來源檔）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hash_file_sha256_sync } from './file_hash.js';
import { lstat_is_reparse_or_symlink } from './path_guard.js';
import { EXPORT_STAGING_DIR } from './constants.js';
import { extract_zip_to_directory as extract_wzaes_zip_to_directory } from './wzaes_zip.js';

/**
 * @param {object} options
 * @param {string} options.zip_path
 * @param {string} options.output_dir
 * @param {string} options.password
 * @param {string[] | null | undefined} [options.members]
 * @param {object | null | undefined} [options.manifest]
 */
export function extract_zip_to_directory(options) {
  if (!options.password) {
    return Promise.resolve({ ok: false, reason_zh: '缺少解壓密碼' });
  }
  return extract_wzaes_zip_to_directory({
    zip_path: options.zip_path,
    output_dir: options.output_dir,
    password: options.password,
    members: options.members,
    manifest: options.manifest,
  });
}

/**
 * @param {string} extract_root
 * @param {string} rel_posix
 * @returns {string | null}
 */
function safe_extracted_file_path(extract_root, rel_posix) {
  const rel = rel_posix.replace(/\\/g, '/');
  if (!rel || rel.startsWith('/') || rel.indexOf('..') >= 0) {
    return null;
  }
  const abs = path.resolve(extract_root, rel.split('/').join(path.sep));
  const root_real = path.resolve(extract_root);
  const rel_check = path.relative(root_real, abs);
  if (!rel_check || rel_check.startsWith('..') || path.isAbsolute(rel_check)) {
    return null;
  }
  return abs;
}

/**
 * @param {object} manifest
 * @param {string} extract_root
 * @returns {{ ok: true } | { ok: false, reason_zh: string }}
 */
export function verify_extracted_tree_matches_manifest(manifest, extract_root) {
  /** @type {string[]} */
  const paths = ['export-manifest.json'];
  for (let i = 0; i < manifest.files.length; i += 1) {
    paths.push(manifest.files[i].path);
  }

  /** @type {Map<string, { size: number, sha256: string }>} */
  const expected_by_path = new Map();
  for (let j = 0; j < manifest.files.length; j += 1) {
    const row = manifest.files[j];
    expected_by_path.set(row.path, { size: row.size, sha256: row.sha256 });
  }

  for (let k = 0; k < paths.length; k += 1) {
    const rel = paths[k];
    const abs = safe_extracted_file_path(extract_root, rel);
    if (!abs) {
      return { ok: false, reason_zh: '解壓路徑不安全或非法：' + rel };
    }
    if (!fs.existsSync(abs)) {
      return { ok: false, reason_zh: 'ZIP 解壓後缺少檔案：' + rel };
    }
    if (lstat_is_reparse_or_symlink(abs)) {
      return { ok: false, reason_zh: '解壓檔為 symlink／reparse：' + rel };
    }

    const h = hash_file_sha256_sync(abs);
    if (rel === 'export-manifest.json') {
      continue;
    }
    const exp = expected_by_path.get(rel);
    if (!exp) {
      return { ok: false, reason_zh: 'manifest 未宣告卻解出：' + rel };
    }
    if (exp.size !== h.size || exp.sha256 !== h.sha256) {
      return {
        ok: false,
        reason_zh:
          '解壓內容 SHA-256／大小與 manifest 不符：' +
          rel +
          '（expected ' +
          exp.sha256 +
          ' got ' +
          h.sha256 +
          '）',
      };
    }
  }

  return { ok: true };
}

/**
 * 比對 ZIP 列表中的檔案大小與 manifest
 * @param {{ path: string, size: number | null }[]} zip_entries
 * @param {object} manifest
 */
export function verify_zip_list_sizes_match_manifest(zip_entries, manifest) {
  /** @type {Map<string, number>} */
  const sizes = new Map();
  for (let i = 0; i < zip_entries.length; i += 1) {
    const e = zip_entries[i];
    if (e.size != null) {
      sizes.set(e.path.replace(/\\/g, '/'), e.size);
    }
  }

  for (let j = 0; j < manifest.files.length; j += 1) {
    const row = manifest.files[j];
    const zsize = sizes.get(row.path);
    if (zsize == null) {
      return { ok: false, reason_zh: 'ZIP 列表缺少檔案大小：' + row.path };
    }
    if (zsize !== row.size) {
      return {
        ok: false,
        reason_zh:
          'ZIP 列表大小與 manifest 不符：' +
          row.path +
          ' zip=' +
          zsize +
          ' manifest=' +
          row.size,
      };
    }
  }

  const manifest_size = sizes.get('export-manifest.json');
  if (manifest_size == null || manifest_size < 1) {
    return { ok: false, reason_zh: 'ZIP 列表缺少 export-manifest.json 大小' };
  }

  return { ok: true };
}

/**
 * @param {object} options
 * @param {string} options.zip_path
 * @param {object} options.manifest
 * @param {string} options.password
 */
export async function verify_zip_contents_by_extract(options) {
  const extract_root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'so-export-unzip-')
  );
  try {
    const extract = await extract_zip_to_directory({
      zip_path: options.zip_path,
      output_dir: extract_root,
      password: options.password,
      manifest: options.manifest,
    });
    if (!extract.ok) {
      return extract;
    }
    return verify_extracted_tree_matches_manifest(
      options.manifest,
      extract_root
    );
  } finally {
    try {
      fs.rmSync(extract_root, { recursive: true, force: true });
    } catch {
      /* 暫存解壓目錄僅在系統 temp */
    }
  }
}

/**
 * 僅允許刪除 export 解壓暫存（非專案 backup）
 * @param {string} dir
 */
export function is_safe_temp_extract_dir(dir) {
  const n = dir.replace(/\\/g, '/').toLowerCase();
  if (n.indexOf('so-export-unzip-') < 0) {
    return false;
  }
  if (n.indexOf(EXPORT_STAGING_DIR) >= 0) {
    return false;
  }
  return true;
}
