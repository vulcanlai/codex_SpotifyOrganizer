/**
 * 以程式錨點解析專案根目錄（不依賴 process.cwd）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_PROJECT_ROOT,
  ENV_ALLOW_PROJECT_ROOT_OVERRIDE,
} from './constants.js';

const LIB_DATA_SYNC_DIR = path.dirname(fileURLToPath(import.meta.url));

/** @returns {string} */
export function resolve_project_root_from_anchor() {
  return path.resolve(LIB_DATA_SYNC_DIR, '..', '..');
}

/**
 * @param {{ project_root_override?: string | null }} [options]
 * @returns {string}
 */
export function resolve_effective_project_root(options) {
  const override =
    options && options.project_root_override
      ? path.resolve(options.project_root_override)
      : null;

  if (override) {
    if (process.env[ENV_ALLOW_PROJECT_ROOT_OVERRIDE] !== '1') {
      throw new Error(
        '拒絕 project_root 覆寫：僅測試環境可設定 ' +
          ENV_ALLOW_PROJECT_ROOT_OVERRIDE +
          '=1'
      );
    }
    return normalize_existing_project_root(override);
  }

  const anchored = resolve_project_root_from_anchor();
  return assert_canonical_production_root(anchored);
}

/**
 * 正式匯出：根目錄必須與 D:\\SpotifyOrganizer 一致（realpath）
 * @param {string} anchored_root
 */
function assert_canonical_production_root(anchored_root) {
  let canonical_real = CANONICAL_PROJECT_ROOT;
  if (fs.existsSync(CANONICAL_PROJECT_ROOT)) {
    try {
      canonical_real = fs.realpathSync(CANONICAL_PROJECT_ROOT);
    } catch {
      canonical_real = path.resolve(CANONICAL_PROJECT_ROOT);
    }
  }

  let anchored_real = path.resolve(anchored_root);
  if (fs.existsSync(anchored_root)) {
    try {
      anchored_real = fs.realpathSync(anchored_root);
    } catch {
      anchored_real = path.resolve(anchored_root);
    }
  }

  if (
    anchored_real.toLowerCase() !== canonical_real.toLowerCase()
  ) {
    throw new Error(
      '專案根目錄必須為 ' +
        CANONICAL_PROJECT_ROOT +
        '（解析為 ' +
        anchored_real +
        '）'
    );
  }
  return anchored_real;
}

/**
 * @param {string} root
 */
function normalize_existing_project_root(root) {
  if (!fs.existsSync(root)) {
    throw new Error('專案根目錄不存在：' + root);
  }
  try {
    return fs.realpathSync(root);
  } catch {
    return path.resolve(root);
  }
}
