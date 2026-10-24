/**
 * 資料同步路徑邊界：專案根目錄、禁止區、輸出 ZIP 位置
 */
import fs from 'node:fs';
import path from 'node:path';
import { is_resolved_path_within_root } from '../classification/manual_classify/safe_data_path.js';
import {
  FORBIDDEN_ABSOLUTE_ROOTS,
  IN_PROJECT_ZIP_OUTPUT_DIR,
} from './constants.js';

/**
 * @param {string} resolved_path
 * @param {string} resolved_root
 */
export function is_path_within_root(resolved_path, resolved_root) {
  return is_resolved_path_within_root(resolved_path, resolved_root);
}

/**
 * @param {string} abs_path
 */
export function touches_forbidden_absolute_root(abs_path) {
  let resolved = path.resolve(abs_path);
  if (fs.existsSync(resolved)) {
    try {
      resolved = fs.realpathSync(resolved);
    } catch {
      return true;
    }
  }

  for (let i = 0; i < FORBIDDEN_ABSOLUTE_ROOTS.length; i += 1) {
    const forbidden = FORBIDDEN_ABSOLUTE_ROOTS[i];
    let forbidden_real = forbidden;
    if (fs.existsSync(forbidden)) {
      try {
        forbidden_real = fs.realpathSync(forbidden);
      } catch {
        forbidden_real = forbidden;
      }
    }
    if (is_path_within_root(resolved, forbidden_real)) {
      return true;
    }
    if (is_path_within_root(forbidden_real, resolved)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {string} candidate
 * @param {string} project_root
 * @returns {string | null}
 */
export function resolve_readable_project_relative_file(candidate, project_root) {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return null;
  }

  const project_real = resolve_dir_realpath(project_root);
  if (!project_real) {
    return null;
  }

  const joined = path.resolve(project_real, candidate);
  if (touches_forbidden_absolute_root(joined)) {
    return null;
  }
  if (!is_path_within_root(joined, project_real)) {
    return null;
  }
  if (!fs.existsSync(joined)) {
    return null;
  }

  let real;
  try {
    real = fs.realpathSync(joined);
  } catch {
    return null;
  }

  if (!is_path_within_root(real, project_real)) {
    return null;
  }
  if (touches_forbidden_absolute_root(real)) {
    return null;
  }

  const stat = fs.lstatSync(real);
  if (stat.isSymbolicLink()) {
    return null;
  }

  return real;
}

/**
 * @param {string} dir_path
 * @returns {string | null}
 */
export function resolve_dir_realpath(dir_path) {
  const resolved = path.resolve(dir_path);
  if (!fs.existsSync(resolved)) {
    return resolved;
  }
  try {
    return fs.realpathSync(resolved);
  } catch {
    return null;
  }
}

/**
 * 將絕對路徑轉為專案內 POSIX 相對路徑
 * @param {string} abs_file
 * @param {string} project_root
 * @returns {string | null}
 */
export function to_project_relative_posix(abs_file, project_root) {
  const project_real = resolve_dir_realpath(project_root);
  if (!project_real) {
    return null;
  }
  let file_real = abs_file;
  try {
    file_real = fs.realpathSync(abs_file);
  } catch {
    return null;
  }
  if (!is_path_within_root(file_real, project_real)) {
    return null;
  }
  const rel = path.relative(project_real, file_real);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return rel.split(path.sep).join('/');
}

/**
 * 驗證 ZIP 輸出路徑
 * @param {string} output_zip_candidate
 * @param {string} project_root
 * @returns {{ ok: true, abs_zip: string } | { ok: false, reason_zh: string }}
 */
export function validate_zip_output_path(output_zip_candidate, project_root) {
  if (typeof output_zip_candidate !== 'string' || !output_zip_candidate.trim()) {
    return { ok: false, reason_zh: '未指定 ZIP 輸出路徑' };
  }

  const abs_zip = path.resolve(output_zip_candidate);
  if (touches_forbidden_absolute_root(abs_zip)) {
    return {
      ok: false,
      reason_zh: 'ZIP 輸出位置位於禁止的工作目錄（workCase／vulcan-project-skills 等）',
    };
  }

  const project_real = resolve_dir_realpath(project_root);
  if (!project_real) {
    return { ok: false, reason_zh: '無法解析專案根目錄' };
  }

  const inside_project = is_path_within_root(abs_zip, project_real);
  if (inside_project) {
    const rel = path.relative(project_real, abs_zip);
    const rel_posix = rel.split(path.sep).join('/');
    const allowed_prefix = IN_PROJECT_ZIP_OUTPUT_DIR + '/';
    if (
      rel_posix.indexOf(allowed_prefix) !== 0 &&
      rel_posix !== IN_PROJECT_ZIP_OUTPUT_DIR
    ) {
      return {
        ok: false,
        reason_zh:
          'ZIP 若放在專案內，必須位於 ' +
          IN_PROJECT_ZIP_OUTPUT_DIR +
          '/ 子目錄下',
      };
    }
  }

  const root_with_sep = path.parse(abs_zip).root;
  if (root_with_sep) {
    const parent_of_zip = path.dirname(abs_zip);
    if (
      parent_of_zip.toLowerCase() === root_with_sep.replace(/\\$/, '').toLowerCase() ||
      parent_of_zip.toLowerCase() === root_with_sep.toLowerCase()
    ) {
      return {
        ok: false,
        reason_zh: '不可將 ZIP 直接寫入磁碟根目錄（例如 D:\\）',
      };
    }
  }

  if (fs.existsSync(abs_zip)) {
    return { ok: false, reason_zh: 'ZIP 已存在，拒絕覆寫：' + abs_zip };
  }

  const out_dir = path.dirname(abs_zip);
  if (touches_forbidden_absolute_root(out_dir)) {
    return { ok: false, reason_zh: 'ZIP 輸出資料夾位於禁止路徑' };
  }

  if (fs.existsSync(out_dir) && lstat_is_reparse_or_symlink(out_dir)) {
    return {
      ok: false,
      reason_zh: 'ZIP 輸出資料夾為 symlink／reparse，拒絕寫入',
    };
  }
  if (fs.existsSync(out_dir)) {
    const out_real = resolve_dir_realpath(out_dir);
    if (!out_real || touches_forbidden_absolute_root(out_real)) {
      return { ok: false, reason_zh: 'ZIP 輸出資料夾 realpath 無法確認或位於禁止區' };
    }
  }

  return { ok: true, abs_zip: abs_zip };
}

/**
 * 驗證匯入來源 ZIP 路徑（必須存在）
 * @param {string} input_zip_candidate
 * @param {string} project_root
 */
export function validate_zip_input_path(input_zip_candidate, project_root) {
  if (typeof input_zip_candidate !== 'string' || !input_zip_candidate.trim()) {
    return { ok: false, reason_zh: '未指定 ZIP 來源路徑' };
  }
  const abs_zip = path.resolve(input_zip_candidate);
  if (touches_forbidden_absolute_root(abs_zip)) {
    return {
      ok: false,
      reason_zh: 'ZIP 來源位於禁止的工作目錄',
    };
  }
  if (!fs.existsSync(abs_zip)) {
    return { ok: false, reason_zh: '找不到 ZIP：' + abs_zip };
  }
  if (lstat_is_reparse_or_symlink(abs_zip)) {
    return { ok: false, reason_zh: 'ZIP 來源為 symlink／reparse，拒絕讀取' };
  }
  const stat = fs.statSync(abs_zip);
  if (!stat.isFile()) {
    return { ok: false, reason_zh: '來源不是一般檔案：' + abs_zip };
  }
  return { ok: true, abs_zip: abs_zip };
}

/**
 * @param {string} entry_path
 */
export function lstat_is_reparse_or_symlink(entry_path) {
  try {
    const st = fs.lstatSync(entry_path);
    if (st.isSymbolicLink()) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}
