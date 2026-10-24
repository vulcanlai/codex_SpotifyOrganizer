/**
 * 自 ZIP 解出後以 SHA-256 驗證與 manifest 一致（非只比對來源檔）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hash_file_sha256_sync } from './file_hash.js';
import { lstat_is_reparse_or_symlink } from './path_guard.js';
import { ENV_ALLOW_7Z_PASSWORD_STDIN, EXPORT_STAGING_DIR } from './constants.js';

/**
 * @param {object} options
 * @param {string} options.executable
 * @param {string} options.zip_path
 * @param {string} options.output_dir
 * @param {'stdin' | 'interactive' | 'seven_zip_test_argv'} options.password_mode
 * @param {string} [options.stdin_password]
 */
export function extract_zip_to_directory(options) {
  fs.mkdirSync(options.output_dir, { recursive: true });
  /** @type {string[]} */
  const args = ['x', '-tzip', '-y', '-o' + options.output_dir, options.zip_path];

  if (options.password_mode === 'seven_zip_test_argv') {
    if (process.env[ENV_ALLOW_7Z_PASSWORD_STDIN] !== '1') {
      throw new Error(
        '拒絕測試用解壓 argv 密碼：7-Zip x 在 Windows 無法 stdin 讀密碼，僅自動化測試可啟用'
      );
    }
    if (!options.stdin_password) {
      throw new Error('缺少解壓密碼');
    }
    args.splice(3, 0, '-p' + options.stdin_password);
  } else if (options.password_mode === 'stdin') {
    args.splice(3, 0, '-p');
  } else {
    args.splice(3, 0, '-p');
  }

  let result;
  if (options.password_mode === 'seven_zip_test_argv') {
    result = spawnSync(options.executable, args, {
      encoding: 'utf8',
      windowsHide: true,
    });
  } else if (options.password_mode === 'stdin') {
    result = spawnSync(options.executable, args, {
      input: (options.stdin_password || '') + '\n',
      encoding: 'utf8',
      windowsHide: true,
    });
  } else {
    result = spawnSync(options.executable, args, {
      stdio: 'inherit',
      windowsHide: false,
    });
  }

  if (result.error) {
    return { ok: false, reason_zh: result.error.message };
  }
  if (result.status !== 0) {
    const detail = ((result.stderr || '') + (result.stdout || '')).trim();
    return {
      ok: false,
      reason_zh:
        '7-Zip 解壓失敗（exit ' +
        result.status +
        '）' +
        (detail ? '：' + detail.slice(0, 200) : ''),
    };
  }
  return { ok: true };
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
 * 比對 7z 列表中的檔案大小與 manifest
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
 * @param {string} options.executable
 * @param {string} options.zip_path
 * @param {object} options.manifest
 * @param {'stdin' | 'interactive' | 'seven_zip_test_argv'} options.password_mode
 * @param {string | null} options.stdin_password
 */
export function verify_zip_contents_by_extract(options) {
  const extract_root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'so-export-unzip-')
  );
  try {
    let mode = options.password_mode;
    if (
      mode === 'stdin' &&
      process.env[ENV_ALLOW_7Z_PASSWORD_STDIN] === '1'
    ) {
      mode = 'seven_zip_test_argv';
    }
    const extract = extract_zip_to_directory({
      executable: options.executable,
      zip_path: options.zip_path,
      output_dir: extract_root,
      password_mode: mode,
      stdin_password: options.stdin_password || '',
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
      if (extract_root.includes('so-export-unzip-')) {
        fs.rmSync(extract_root, { recursive: true, force: true });
      }
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
