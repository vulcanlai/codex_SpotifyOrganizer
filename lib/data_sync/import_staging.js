/**
 * 匯入解壓暫存目錄（非正式 backup）
 */
import fs from 'node:fs';
import path from 'node:path';
import { IMPORT_STAGING_DIR } from './constants.js';

/**
 * @param {string} project_root
 */
export function create_import_staging_dir(project_root) {
  const base = path.join(project_root, IMPORT_STAGING_DIR);
  const run_id =
    new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const dir = path.join(base, run_id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {string} staging_root
 */
export function safe_remove_import_staging_dir(staging_root) {
  if (!staging_root || !fs.existsSync(staging_root)) {
    return;
  }
  if (!staging_root.includes(IMPORT_STAGING_DIR)) {
    throw new Error('拒絕刪除非 import staging：' + staging_root);
  }
  fs.rmSync(staging_root, { recursive: true, force: true });
}
