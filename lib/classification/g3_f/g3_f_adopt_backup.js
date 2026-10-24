/**
 * G3-F 採用前備份／還原（registry + 正式分類產物）
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FILE_CLASSIFICATION_INDEX,
  FILE_CLASSIFICATION_SUMMARY,
  FILE_FORMAL_CLASSIFICATION_STATE,
  FILE_G3_F_ADOPT_REGISTRY,
  CLASSIFICATION_DIR,
} from '../paths.js';

export const G3_F_ADOPT_BACKUP_FILES = [
  'g3-f-adopt-registry.json',
  'classification-index.json',
  'classification-summary.json',
  'formal-classification-state.json',
];

/**
 * @param {object} [opts]
 */
export function create_g3_f_adopt_backup(opts) {
  const options = opts || {};
  const backup_root =
    options.backup_root ||
    path.join(options.project_root || process.cwd(), 'backup', 'classification', 'g3-f-adopt-snapshots');
  const stamp = options.backup_id || new Date().toISOString().replace(/[:.]/g, '-');
  const dest_dir = path.join(backup_root, stamp);
  fs.mkdirSync(dest_dir, { recursive: true });

  const copied = [];
  const missing = [];
  const classification_dir = options.classification_dir || CLASSIFICATION_DIR;
  for (let i = 0; i < G3_F_ADOPT_BACKUP_FILES.length; i += 1) {
    const name = G3_F_ADOPT_BACKUP_FILES[i];
    const src = path.join(classification_dir, name);
    if (!fs.existsSync(src)) {
      missing.push(name);
      continue;
    }
    fs.copyFileSync(src, path.join(dest_dir, name));
    copied.push(name);
  }

  const manifest = {
    schema_version: 1,
    backup_id: stamp,
    created_at: new Date().toISOString(),
    copied_files: copied,
    missing_files: missing,
    restore_note_zh: '還原時將覆寫 backup/classification/ 同名檔案；執行前請確認無其他寫入進行中。',
  };
  fs.writeFileSync(
    path.join(dest_dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  return { backup_dir: dest_dir, manifest: manifest };
}

/**
 * @param {string} backup_dir
 * @param {object} [opts]
 */
export function restore_g3_f_adopt_backup(backup_dir, opts) {
  const options = opts || {};
  const classification_dir = options.classification_dir || CLASSIFICATION_DIR;
  const manifest_path = path.join(backup_dir, 'manifest.json');
  if (!fs.existsSync(manifest_path)) {
    throw new Error('缺少 manifest.json：' + backup_dir);
  }
  const manifest = JSON.parse(fs.readFileSync(manifest_path, 'utf8'));
  const files = manifest.copied_files || G3_F_ADOPT_BACKUP_FILES;
  const restored = [];
  for (let i = 0; i < files.length; i += 1) {
    const name = files[i];
    const src = path.join(backup_dir, name);
    if (!fs.existsSync(src)) {
      continue;
    }
    fs.copyFileSync(src, path.join(classification_dir, name));
    restored.push(name);
  }
  return { restored_files: restored, backup_id: manifest.backup_id };
}
