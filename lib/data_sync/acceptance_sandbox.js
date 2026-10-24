/**
 * 模擬公司端匯入驗收：沙箱路徑建立、驗證與安全清理
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CANONICAL_PROJECT_ROOT,
  FORBIDDEN_ABSOLUTE_ROOTS,
} from './constants.js';
import {
  is_path_within_root,
  lstat_is_reparse_or_symlink,
  resolve_dir_realpath,
  touches_forbidden_absolute_root,
} from './path_guard.js';
import { collect_minimal_export_files } from './export_profile_minimal.js';
import { hash_file_sha256_sync } from './file_hash.js';

export const ACCEPTANCE_SANDBOX_DIR_PREFIX = 'so-company-sim-';

/**
 * @returns {string}
 */
export function resolve_system_temp_realpath() {
  const tmp = os.tmpdir();
  if (!tmp) {
    throw new Error('無法解析系統 TEMP 目錄');
  }
  return resolve_dir_realpath(tmp) || path.resolve(tmp);
}

/**
 * @param {string} sandbox_path
 * @param {string} formal_anchor_root
 */
export function validate_acceptance_sandbox_path(sandbox_path, formal_anchor_root) {
  if (typeof sandbox_path !== 'string' || !sandbox_path.trim()) {
    return { ok: false, reason_zh: '沙箱路徑為空' };
  }

  const base = path.basename(sandbox_path);
  if (base.indexOf(ACCEPTANCE_SANDBOX_DIR_PREFIX) !== 0) {
    return {
      ok: false,
      reason_zh: '沙箱目錄名稱必須以 ' + ACCEPTANCE_SANDBOX_DIR_PREFIX + ' 開頭',
    };
  }

  if (!fs.existsSync(sandbox_path)) {
    return { ok: false, reason_zh: '沙箱目錄不存在：' + sandbox_path };
  }

  if (lstat_is_reparse_or_symlink(sandbox_path)) {
    return { ok: false, reason_zh: '沙箱為 symlink／reparse，拒絕使用' };
  }

  let sandbox_real;
  try {
    sandbox_real = fs.realpathSync(sandbox_path);
  } catch {
    return { ok: false, reason_zh: '無法解析沙箱 realpath' };
  }

  if (lstat_is_reparse_or_symlink(sandbox_real)) {
    return { ok: false, reason_zh: '沙箱 realpath 為 symlink／reparse' };
  }

  const temp_real = resolve_system_temp_realpath();
  if (!is_path_within_root(sandbox_real, temp_real)) {
    return {
      ok: false,
      reason_zh: '沙箱必須位於系統 TEMP 目錄內（' + temp_real + '）',
    };
  }

  if (touches_forbidden_absolute_root(sandbox_real)) {
    return { ok: false, reason_zh: '沙箱位於禁止的工作目錄' };
  }

  let formal_real = path.resolve(formal_anchor_root);
  if (fs.existsSync(formal_anchor_root)) {
    try {
      formal_real = fs.realpathSync(formal_anchor_root);
    } catch {
      formal_real = path.resolve(formal_anchor_root);
    }
  }

  if (
    sandbox_real.toLowerCase() === formal_real.toLowerCase() ||
    sandbox_real.toLowerCase() === path.resolve(CANONICAL_PROJECT_ROOT).toLowerCase()
  ) {
    return { ok: false, reason_zh: '沙箱不得等於正式專案根目錄' };
  }

  if (is_path_within_root(sandbox_real, formal_real)) {
    return { ok: false, reason_zh: '沙箱不得位於正式專案目錄內' };
  }

  if (is_path_within_root(formal_real, sandbox_real)) {
    return { ok: false, reason_zh: '正式專案不得位於沙箱目錄內' };
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
    if (is_path_within_root(sandbox_real, forbidden_real)) {
      return { ok: false, reason_zh: '沙箱位於禁止根目錄內' };
    }
  }

  return { ok: true, sandbox_real: sandbox_real };
}

/**
 * @param {string} formal_anchor_root
 * @returns {{ sandbox_path: string, sandbox_real: string }}
 */
export function create_unique_acceptance_sandbox(formal_anchor_root) {
  const temp_real = resolve_system_temp_realpath();
  const sandbox_path = fs.mkdtempSync(
    path.join(temp_real, ACCEPTANCE_SANDBOX_DIR_PREFIX)
  );
  const check = validate_acceptance_sandbox_path(sandbox_path, formal_anchor_root);
  if (!check.ok) {
    try {
      fs.rmSync(sandbox_path, { recursive: true, force: true });
    } catch {
      /* */
    }
    throw new Error(check.reason_zh);
  }
  return {
    sandbox_path: sandbox_path,
    sandbox_real: check.sandbox_real || sandbox_path,
  };
}

/**
 * @param {string} expected_sandbox_real
 * @param {string} candidate_path
 */
export function assert_sandbox_path_matches_created(
  expected_sandbox_real,
  candidate_path
) {
  let candidate_real;
  try {
    candidate_real = fs.realpathSync(candidate_path);
  } catch {
    return { ok: false, reason_zh: '清理前無法解析沙箱 realpath' };
  }
  if (
    candidate_real.toLowerCase() !== expected_sandbox_real.toLowerCase()
  ) {
    return {
      ok: false,
      reason_zh: '沙箱路徑與本次建立不一致，拒絕清理',
    };
  }
  const recheck = validate_acceptance_sandbox_path(
    candidate_real,
    CANONICAL_PROJECT_ROOT
  );
  if (!recheck.ok) {
    return recheck;
  }
  return { ok: true, sandbox_real: candidate_real };
}

/**
 * @param {string} expected_sandbox_real
 * @param {string} sandbox_path
 */
export function remove_acceptance_sandbox_safely(
  expected_sandbox_real,
  sandbox_path
) {
  const match = assert_sandbox_path_matches_created(
    expected_sandbox_real,
    sandbox_path
  );
  if (!match.ok) {
    return match;
  }
  if (lstat_is_reparse_or_symlink(match.sandbox_real)) {
    return { ok: false, reason_zh: '沙箱為 reparse／symlink，拒絕刪除' };
  }
  fs.rmSync(match.sandbox_real, { recursive: true, force: true });
  return { ok: true };
}

/**
 * @param {string} formal_root
 */
export function snapshot_formal_sync_guard(formal_root) {
  const collected = collect_minimal_export_files(formal_root);
  /** @type {Record<string, { size: number, sha256: string } | null>} */
  const snap = {};
  if (!collected.ok) {
    return { ok: true, files: snap, note: collected.reason_zh };
  }
  for (let i = 0; i < collected.files.length; i += 1) {
    const rel = collected.files[i];
    const abs = path.join(formal_root, rel.split('/').join(path.sep));
    if (!fs.existsSync(abs)) {
      snap[rel] = null;
      continue;
    }
    snap[rel] = hash_file_sha256_sync(abs);
  }
  const state_dir = path.join(formal_root, '.data-sync-state');
  const state_files = ['last-import.json', 'last-export.json'];
  for (let j = 0; j < state_files.length; j += 1) {
    const rel = '.data-sync-state/' + state_files[j];
    const abs = path.join(state_dir, state_files[j]);
    if (!fs.existsSync(abs)) {
      snap[rel] = null;
      continue;
    }
    snap[rel] = hash_file_sha256_sync(abs);
  }
  return { ok: true, files: snap };
}

/**
 * @param {string} formal_root
 * @param {Record<string, { size: number, sha256: string } | null>} before
 */
export function verify_formal_sync_guard_unchanged(formal_root, before) {
  const after = snapshot_formal_sync_guard(formal_root);
  if (!after.ok) {
    return after;
  }
  const keys = Object.keys(before.files);
  for (let i = 0; i < keys.length; i += 1) {
    const rel = keys[i];
    const a = before.files[rel];
    const b = after.files[rel];
    if (!a && !b) {
      continue;
    }
    if (!a || !b) {
      return {
        ok: false,
        reason_zh: '正式資料異動：' + rel + '（存在性改變）',
      };
    }
    if (a.sha256 !== b.sha256 || a.size !== b.size) {
      return {
        ok: false,
        reason_zh: '正式資料異動：' + rel,
      };
    }
  }
  return { ok: true };
}
