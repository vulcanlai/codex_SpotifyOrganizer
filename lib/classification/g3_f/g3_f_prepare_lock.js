/**
 * G3-F prepare 單程序鎖（每 wave 目錄獨立 lock 檔）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { G3_F1_PREPARE_LOCK_MAX_AGE_MS, FILE_G3_F1_PREPARE_LOCK } from './paths_f1.js';

export class G3FPrepareLockError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'G3FPrepareLockError';
  }
}

/** @deprecated */
export const G3F1PrepareLockError = G3FPrepareLockError;

function lock_is_stale(doc, max_age_ms) {
  if (!doc || !doc.started_at) {
    return true;
  }
  const age = Date.now() - Date.parse(doc.started_at);
  return age > max_age_ms;
}

/**
 * @param {{ wave_dir: string, lock_file?: string, max_age_ms?: number, label?: string }} paths
 */
export function acquire_g3_f_prepare_lock(paths) {
  const lock_file = paths.lock_file || FILE_G3_F1_PREPARE_LOCK;
  const max_age = paths.max_age_ms || G3_F1_PREPARE_LOCK_MAX_AGE_MS;
  const label = paths.label || 'g3:f-prepare';
  fs.mkdirSync(paths.wave_dir, { recursive: true });
  if (fs.existsSync(lock_file)) {
    const existing = JSON.parse(fs.readFileSync(lock_file, 'utf8'));
    if (!lock_is_stale(existing, max_age)) {
      throw new G3FPrepareLockError(
        '已有 prepare 進行中（pid ' +
          existing.pid +
          '）；勿平行啟動。若確定無程序在跑，等待 ' +
          Math.round(max_age / 60000) +
          ' 分鐘或刪除 ' +
          lock_file
      );
    }
  }
  write_json_atomic(lock_file, {
    schema_version: 1,
    pid: process.pid,
    started_at: new Date().toISOString(),
    note_zh: '同一時間僅允許一個 ' + label,
  });
}

/**
 * @param {{ lock_file?: string }} [paths]
 */
export function release_g3_f_prepare_lock(paths) {
  const lock_file = (paths && paths.lock_file) || FILE_G3_F1_PREPARE_LOCK;
  if (fs.existsSync(lock_file)) {
    const doc = JSON.parse(fs.readFileSync(lock_file, 'utf8'));
    if (doc.pid === process.pid) {
      fs.unlinkSync(lock_file);
    }
  }
}

/** @deprecated */
export function acquire_g3_f1_prepare_lock(paths) {
  return acquire_g3_f_prepare_lock(
    Object.assign({}, paths, { lock_file: FILE_G3_F1_PREPARE_LOCK, label: 'g3:f1-prepare' })
  );
}

/** @deprecated */
export function release_g3_f1_prepare_lock() {
  return release_g3_f_prepare_lock({ lock_file: FILE_G3_F1_PREPARE_LOCK });
}
