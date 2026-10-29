/**
 * 匯入前備份與復原（僅專案內 .data-sync-pre-import-backup）
 */
import fs from 'node:fs';
import path from 'node:path';
import { PRE_IMPORT_BACKUP_DIR } from './constants.js';
import { hash_file_sha256_sync } from './file_hash.js';
import {
  sync_export_state_file_path,
  sync_import_state_file_path,
} from './sync_state.js';

/**
 * @param {string} project_root
 */
export function create_pre_import_backup_run_dir(project_root) {
  const base = path.join(project_root, PRE_IMPORT_BACKUP_DIR);
  const run_id =
    new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const run_dir = path.join(base, run_id);
  fs.mkdirSync(run_dir, { recursive: true });
  return run_dir;
}

/**
 * @param {string} project_root
 * @param {string} backup_run_dir
 * @param {string[]} manifest_paths
 */
export function write_pre_import_backup(project_root, backup_run_dir, manifest_paths) {
  /** @type {string[]} */
  const backed_up = [];
  /** @type {string[]} */
  const added_only = [];
  const state_copies = [];

  for (let i = 0; i < manifest_paths.length; i += 1) {
    const rel = manifest_paths[i];
    const src = path.join(project_root, rel.split('/').join(path.sep));
    if (!fs.existsSync(src)) {
      added_only.push(rel);
      continue;
    }
    const dest = path.join(backup_run_dir, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    backed_up.push(rel);
  }

  const import_state = sync_import_state_file_path(project_root);
  if (fs.existsSync(import_state)) {
    const state_backup = path.join(
      backup_run_dir,
      '_sync_state',
      'last-import.json'
    );
    fs.mkdirSync(path.dirname(state_backup), { recursive: true });
    fs.copyFileSync(import_state, state_backup);
    state_copies.push([import_state, state_backup]);
  }
  const export_state = sync_export_state_file_path(project_root);
  if (fs.existsSync(export_state)) {
    const exp_backup = path.join(
      backup_run_dir,
      '_sync_state',
      'last-export.json'
    );
    fs.mkdirSync(path.dirname(exp_backup), { recursive: true });
    fs.copyFileSync(export_state, exp_backup);
    state_copies.push([export_state, exp_backup]);
  }

  const meta = {
    backed_up_paths: backed_up,
    paths_were_absent: added_only,
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(backup_run_dir, 'backup-meta.json'),
    JSON.stringify(meta, null, 2),
    'utf8'
  );

  for (let j = 0; j < backed_up.length; j += 1) {
    const rel = backed_up[j];
    const src = path.join(project_root, rel.split('/').join(path.sep));
    const bak = path.join(backup_run_dir, rel.split('/').join(path.sep));
    const a = hash_file_sha256_sync(src);
    const b = hash_file_sha256_sync(bak);
    if (a.sha256 !== b.sha256) {
      return { ok: false, reason_zh: '匯入前備份驗證失敗：' + rel };
    }
  }

  for (const [live, saved] of state_copies) {
    if (hash_file_sha256_sync(live).sha256 !== hash_file_sha256_sync(saved).sha256) {
      return { ok: false, reason_zh: '匯入前交接紀錄備份驗證失敗' };
    }
  }
  return { ok: true, meta: meta, backup_run_dir: backup_run_dir };
}

/**
 * @param {string} project_root
 * @param {string} backup_run_dir
 * @param {object} meta
 */
export function restore_from_pre_import_backup(project_root, backup_run_dir, meta) {
  const backed = meta.backed_up_paths || [];
  for (let i = 0; i < backed.length; i += 1) {
    const rel = backed[i];
    const dest = path.join(project_root, rel.split('/').join(path.sep));
    const src = path.join(backup_run_dir, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  const absent = meta.paths_were_absent || [];
  for (let j = 0; j < absent.length; j += 1) {
    const rel = absent[j];
    const target = path.join(project_root, rel.split('/').join(path.sep));
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }

  const import_backup = path.join(
    backup_run_dir,
    '_sync_state',
    'last-import.json'
  );
  const import_live = sync_import_state_file_path(project_root);
  if (fs.existsSync(import_backup)) {
    fs.mkdirSync(path.dirname(import_live), { recursive: true });
    fs.copyFileSync(import_backup, import_live);
  } else if (fs.existsSync(import_live)) {
    fs.unlinkSync(import_live);
  }

  const export_backup = path.join(
    backup_run_dir,
    '_sync_state',
    'last-export.json'
  );
  const export_live = sync_export_state_file_path(project_root);
  if (fs.existsSync(export_backup)) {
    fs.mkdirSync(path.dirname(export_live), { recursive: true });
    fs.copyFileSync(export_backup, export_live);
  } else if (fs.existsSync(export_live)) {
    fs.unlinkSync(export_live);
  }

  return { ok: true };
}
