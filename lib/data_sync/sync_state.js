/**
 * .data-sync-state 匯入／匯出交接紀錄
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  EXPORT_STATE_FILENAME,
  IMPORT_STATE_FILENAME,
  SYNC_STATE_DIR,
  SYNC_STATE_SCHEMA_VERSION,
} from './constants.js';

/**
 * @param {string} project_root
 */
export function sync_import_state_file_path(project_root) {
  return path.join(project_root, SYNC_STATE_DIR, IMPORT_STATE_FILENAME);
}

/**
 * @param {string} project_root
 */
export function sync_export_state_file_path(project_root) {
  return path.join(project_root, SYNC_STATE_DIR, EXPORT_STATE_FILENAME);
}

/** @deprecated 使用 sync_import_state_file_path */
export function sync_state_file_path(project_root) {
  return sync_import_state_file_path(project_root);
}

/**
 * @param {string} file
 */
function read_state_file(file) {
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (doc.schema_version !== SYNC_STATE_SCHEMA_VERSION) {
      return { corrupt: true, reason_zh: '交接狀態 schema 版本不符' };
    }
    return doc;
  } catch (err) {
    return {
      corrupt: true,
      reason_zh: '無法解析交接狀態：' + (err.message || String(err)),
    };
  }
}

/**
 * @param {string} project_root
 */
export function read_sync_import_state(project_root) {
  return read_state_file(sync_import_state_file_path(project_root));
}

/**
 * @param {string} project_root
 */
export function read_sync_export_state(project_root) {
  return read_state_file(sync_export_state_file_path(project_root));
}

/** @deprecated */
export function read_sync_state(project_root) {
  return read_sync_import_state(project_root);
}

/**
 * @param {string} file
 * @param {object} state_doc
 */
function write_state_file(file, state_doc) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state_doc, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * @param {string} project_root
 * @param {object} state_doc
 */
export function write_sync_import_state(project_root, state_doc) {
  write_state_file(sync_import_state_file_path(project_root), state_doc);
}

/**
 * @param {string} project_root
 * @param {object} state_doc
 */
export function write_sync_export_state(project_root, state_doc) {
  write_state_file(sync_export_state_file_path(project_root), state_doc);
}

/** @deprecated */
export function write_sync_state(project_root, state_doc) {
  write_sync_import_state(project_root, state_doc);
}

/**
 * 決定下一包匯出的 handoff_previous_bundle_id
 * @param {string} project_root
 */
export function resolve_handoff_previous_bundle_id_for_export(project_root) {
  const imp = read_sync_import_state(project_root);
  const exp = read_sync_export_state(project_root);
  if (imp && !imp.corrupt && imp.last_bundle_id) {
    return imp.last_bundle_id;
  }
  if (exp && !exp.corrupt && exp.last_bundle_id) {
    return exp.last_bundle_id;
  }
  return null;
}
