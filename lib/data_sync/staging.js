/**
 * 匯出暫存：hardlink／copy 鏡像（不修改 backup 正式檔）
 */
import fs from 'node:fs';
import path from 'node:path';
import { EXPORT_STAGING_DIR } from './constants.js';

/**
 * @param {string} project_root
 * @returns {string}
 */
export function create_export_staging_dir(project_root) {
  const base = path.join(project_root, EXPORT_STAGING_DIR);
  const run_id =
    new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const staging = path.join(base, run_id);
  fs.mkdirSync(staging, { recursive: true });
  return staging;
}

/**
 * @param {string} staging_root
 * @param {{ relative_path: string, abs_path: string }[]} files
 * @param {object} manifest_doc
 */
export function materialize_staging_tree(staging_root, files, manifest_doc) {
  const manifest_path = path.join(staging_root, 'export-manifest.json');
  fs.writeFileSync(manifest_path, JSON.stringify(manifest_doc, null, 2), 'utf8');

  for (let i = 0; i < files.length; i += 1) {
    const rel = files[i].relative_path;
    const src = files[i].abs_path;
    const dest = path.join(staging_root, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    link_or_copy_readonly(src, dest);
  }
}

/**
 * @param {string} src
 * @param {string} dest
 */
function link_or_copy_readonly(src, dest) {
  if (fs.existsSync(dest)) {
    return;
  }
  try {
    fs.linkSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
  }
}

/**
 * 僅刪除本次 staging 目錄
 * @param {string} staging_root
 */
export function safe_remove_staging_dir(staging_root) {
  if (!staging_root || !fs.existsSync(staging_root)) {
    return;
  }
  if (!staging_root.includes(EXPORT_STAGING_DIR)) {
    throw new Error('拒絕刪除非 data-sync staging 目錄：' + staging_root);
  }
  fs.rmSync(staging_root, { recursive: true, force: true });
}
