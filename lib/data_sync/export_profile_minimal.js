/**
 * minimal 匯出 profile：掃描允許納入的檔案（唯讀）
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  EXPORT_STAGING_DIR,
  IN_PROJECT_ZIP_OUTPUT_DIR,
} from './constants.js';
import {
  lstat_is_reparse_or_symlink,
  resolve_dir_realpath,
  to_project_relative_posix,
  is_path_within_root,
} from './path_guard.js';

/** @type {string[]} */
export const REQUIRED_RELATIVE_FILES = [
  'backup/merged/library-v2.json',
  'backup/classification/manual-overrides.json',
  'backup/classification/classification-index.json',
  'backup/classification/classification-summary.json',
  'backup/classification/classification-settings.json',
  'backup/classification/formal-classification-state.json',
  'backup/classification/g3-f-adopt-registry.json',
];

/** @type {string[]} */
export const CLASSIFICATION_ROOT_JSON = [
  'backup/classification/manual-overrides.json',
  'backup/classification/classification-index.json',
  'backup/classification/classification-summary.json',
  'backup/classification/classification-settings.json',
  'backup/classification/formal-classification-state.json',
  'backup/classification/g3-f-adopt-registry.json',
];

/** @type {string[]} backup 根目錄 JSON（存在才納入） */
export const BACKUP_ROOT_JSON_NAMES = [
  'playlists.json',
  'playlist-tracks.json',
  'liked-tracks.json',
  'summary.json',
];

/**
 * @param {string} rel_posix
 */
export function should_exclude_relative_path(rel_posix) {
  const rel = rel_posix.replace(/\\/g, '/');

  if (
    rel === '.env' ||
    rel === '.spotify_tokens.json' ||
    rel.startsWith('node_modules/') ||
    rel.startsWith('public/manual-classify-ui/') ||
    rel.startsWith(EXPORT_STAGING_DIR + '/') ||
    rel === EXPORT_STAGING_DIR ||
    rel.startsWith(IN_PROJECT_ZIP_OUTPUT_DIR + '/') ||
    rel === IN_PROJECT_ZIP_OUTPUT_DIR
  ) {
    return true;
  }

  if (rel.endsWith('.log') || rel.endsWith('.bak')) {
    return true;
  }
  if (rel.endsWith('.enrich.lock')) {
    return true;
  }
  if (/classification-index\.json\.\d+\.tmp$/.test(rel)) {
    return true;
  }

  if (rel.startsWith('backup/manual/')) {
    return true;
  }
  if (rel.startsWith('backup/classification/snapshots/')) {
    return true;
  }
  if (/^backup\/classification\/incident-pre-restore-/.test(rel)) {
    return true;
  }

  if (/^backup\/classification\/g3-[bcde]/.test(rel)) {
    return true;
  }
  if (rel.startsWith('backup/classification/ai-test/')) {
    return true;
  }
  if (rel.startsWith('backup/classification/backups/')) {
    return true;
  }

  if (rel.startsWith('reports/') && !rel.startsWith('reports/g3-f-adopt/')) {
    return true;
  }

  if (rel.startsWith('imports/') && !/\.txt$/i.test(rel)) {
    return true;
  }

  return false;
}

/**
 * @param {string} classification_dir
 * @returns {string[]}
 */
export function list_g3_f_wave_dir_names(classification_dir) {
  if (!fs.existsSync(classification_dir)) {
    return [];
  }
  /** @type {string[]} */
  const names = [];
  const entries = fs.readdirSync(classification_dir);
  for (let i = 0; i < entries.length; i += 1) {
    if (/^g3-f\d+-wave-\d+$/.test(entries[i])) {
      names.push(entries[i]);
    }
  }
  names.sort();
  return names;
}

/**
 * @param {string} project_root
 * @returns {string[]}
 */
export function build_minimal_scan_roots(project_root) {
  /** @type {string[]} */
  const roots = [
    'backup/merged',
    'backup/library',
    'backup/imported',
    'backup/enrichment',
    'backup/classification/g3-f-adopt-snapshots',
    'backup/classification/mvp-smart-playlists',
    'reports/g3-f-adopt',
    'imports',
  ];

  const classification_dir = path.join(project_root, 'backup', 'classification');
  const waves = list_g3_f_wave_dir_names(classification_dir);
  for (let i = 0; i < waves.length; i += 1) {
    roots.push(path.join('backup', 'classification', waves[i]).split(path.sep).join('/'));
  }

  for (let j = 0; j < BACKUP_ROOT_JSON_NAMES.length; j += 1) {
    roots.push(path.join('backup', BACKUP_ROOT_JSON_NAMES[j]).split(path.sep).join('/'));
  }

  for (let k = 0; k < CLASSIFICATION_ROOT_JSON.length; k += 1) {
    roots.push(CLASSIFICATION_ROOT_JSON[k]);
  }

  return roots;
}

/**
 * @param {string} project_root
 * @param {string} scan_root_rel_posix
 * @param {Set<string>} dest
 */
function walk_scan_root(project_root, scan_root_rel_posix, dest) {
  const project_real = resolve_dir_realpath(project_root);
  if (!project_real) {
    return;
  }

  const abs_root = path.join(project_real, scan_root_rel_posix.split('/').join(path.sep));
  if (!fs.existsSync(abs_root)) {
    return;
  }

  if (lstat_is_reparse_or_symlink(abs_root)) {
    throw new Error('拒絕符號連結或 reparse 目錄：' + scan_root_rel_posix);
  }

  const stat = fs.statSync(abs_root);
  if (stat.isFile()) {
    add_file_if_allowed(abs_root, project_real, dest);
    return;
  }
  if (!stat.isDirectory()) {
    return;
  }

  /** @type {string[]} */
  const stack = [abs_root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) {
      continue;
    }
    if (lstat_is_reparse_or_symlink(dir)) {
      throw new Error('拒絕符號連結或 reparse 目錄：' + dir);
    }

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      throw new Error('無法讀取目錄：' + dir + '（' + err.message + '）');
    }

    for (let i = 0; i < entries.length; i += 1) {
      const ent = entries[i];
      const full = path.join(dir, ent.name);
      const rel_posix = to_project_relative_posix(full, project_real);
      if (!rel_posix) {
        throw new Error('路徑超出專案邊界：' + full);
      }
      if (should_exclude_relative_path(rel_posix)) {
        continue;
      }

      if (ent.isSymbolicLink()) {
        throw new Error('拒絕符號連結：' + rel_posix);
      }
      if (ent.isFile()) {
        add_file_if_allowed(full, project_real, dest);
      } else if (ent.isDirectory()) {
        stack.push(full);
      }
    }
  }
}

/**
 * @param {string} abs_file
 * @param {string} project_real
 * @param {Set<string>} dest
 */
function add_file_if_allowed(abs_file, project_real, dest) {
  if (lstat_is_reparse_or_symlink(abs_file)) {
    throw new Error('拒絕符號連結檔案：' + abs_file);
  }
  let real;
  try {
    real = fs.realpathSync(abs_file);
  } catch {
    throw new Error('無法解析檔案路徑：' + abs_file);
  }
  if (!is_path_within_root(real, project_real)) {
    throw new Error('檔案 realpath 超出專案邊界：' + abs_file);
  }
  const rel = to_project_relative_posix(real, project_real);
  if (!rel || should_exclude_relative_path(rel)) {
    return;
  }
  dest.add(rel);
}

/**
 * @param {string} project_root
 * @returns {{ files: string[], missing_required: string[] }}
 */
export function collect_minimal_export_files(project_root) {
  const roots = build_minimal_scan_roots(project_root);
  /** @type {Set<string>} */
  const files = new Set();

  for (let i = 0; i < roots.length; i += 1) {
    walk_scan_root(project_root, roots[i], files);
  }

  /** @type {string[]} */
  const missing_required = [];
  for (let j = 0; j < REQUIRED_RELATIVE_FILES.length; j += 1) {
    const req = REQUIRED_RELATIVE_FILES[j];
    if (!files.has(req)) {
      const abs = path.join(project_root, req.split('/').join(path.sep));
      if (!fs.existsSync(abs)) {
        missing_required.push(req);
      } else {
        files.add(req);
      }
    }
  }

  const sorted = Array.from(files).sort();
  return { files: sorted, missing_required: missing_required };
}

/**
 * 唯讀盤點容量（不建立 ZIP）
 * @param {string} project_root
 */
export function inventory_minimal_export(project_root) {
  const collected = collect_minimal_export_files(project_root);
  let total_bytes = 0;
  for (let i = 0; i < collected.files.length; i += 1) {
    const abs = path.join(
      project_root,
      collected.files[i].split('/').join(path.sep)
    );
    try {
      total_bytes += fs.statSync(abs).size;
    } catch {
      /* 略過 */
    }
  }
  return {
    file_count: collected.files.length,
    total_bytes: total_bytes,
    missing_required: collected.missing_required,
    g3_f_wave_dirs: list_g3_f_wave_dir_names(
      path.join(project_root, 'backup', 'classification')
    ),
  };
}
