/**
 * 本機資料 JSON 路徑邊界（Windows 路徑、符號連結）
 */
import fs from 'node:fs';
import path from 'node:path';
import { project_root } from '../../config.js';

/** @type {string[]} */
export const DEFAULT_MANUAL_CLASSIFY_DATA_ROOTS = [
  path.join(project_root, 'backup'),
  path.join(project_root, 'data'),
];

/**
 * @param {string} resolved_path
 * @param {string} resolved_root
 */
export function is_resolved_path_within_root(resolved_path, resolved_root) {
  const rel = path.relative(resolved_root, resolved_path);
  if (rel === '') {
    return true;
  }
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return false;
  }
  return true;
}

/**
 * @param {string} root_path
 */
function resolve_root_for_boundary_check(root_path) {
  const resolved = path.resolve(root_path);
  if (!fs.existsSync(resolved)) {
    return resolved;
  }
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * @param {string} candidate
 * @param {string[]|null|undefined} allowed_roots
 * @returns {string|null} 允許時回傳正規化後絕對路徑，否則 null
 */
export function resolve_allowed_data_file_path(candidate, allowed_roots) {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return null;
  }
  const roots =
    allowed_roots && allowed_roots.length
      ? allowed_roots
      : DEFAULT_MANUAL_CLASSIFY_DATA_ROOTS;

  let resolved = path.resolve(candidate);
  if (fs.existsSync(resolved)) {
    try {
      resolved = fs.realpathSync(resolved);
    } catch {
      return null;
    }
  }

  for (let i = 0; i < roots.length; i += 1) {
    const root_resolved = resolve_root_for_boundary_check(roots[i]);
    if (is_resolved_path_within_root(resolved, root_resolved)) {
      return resolved;
    }
  }
  return null;
}
