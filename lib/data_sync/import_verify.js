/**
 * 匯入 ZIP 解壓後驗證（manifest、雜湊、白名單、成員一致）
 */
import fs from 'node:fs';
import path from 'node:path';
import { EXPORT_MANIFEST_SCHEMA_VERSION } from './constants.js';
import { hash_manifest_file_sha256 } from './bundle_id.js';
import { verify_extracted_tree_matches_manifest } from './zip_content_verify.js';
import {
  detect_case_insensitive_path_collisions,
  normalize_and_validate_import_member_path,
} from './import_path_rules.js';
import { REQUIRED_RELATIVE_FILES } from './export_profile_minimal.js';
import { lstat_is_reparse_or_symlink } from './path_guard.js';

/**
 * @param {string} extract_root
 */
export function load_manifest_from_extract(extract_root) {
  const manifest_path = path.join(extract_root, 'export-manifest.json');
  if (!fs.existsSync(manifest_path)) {
    return { ok: false, reason_zh: '缺少 export-manifest.json' };
  }
  if (lstat_is_reparse_or_symlink(manifest_path)) {
    return { ok: false, reason_zh: 'export-manifest.json 為 symlink／reparse' };
  }
  const text = fs.readFileSync(manifest_path, 'utf8');
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason_zh: 'export-manifest.json 非合法 JSON' };
  }
  if (doc.manifest_schema_version !== EXPORT_MANIFEST_SCHEMA_VERSION) {
    return {
      ok: false,
      reason_zh: 'manifest_schema_version 不符（' + doc.manifest_schema_version + '）',
    };
  }
  if (doc.profile !== 'minimal') {
    return { ok: false, reason_zh: '不支援的 profile：' + doc.profile };
  }
  return {
    ok: true,
    manifest: doc,
    manifest_text: text,
    manifest_sha256: hash_manifest_file_sha256(text),
  };
}

/**
 * @param {object} manifest
 */
export function validate_manifest_required_files(manifest) {
  const set = new Set(
    (manifest.files || []).map(function (f) {
      return f.path;
    })
  );
  /** @type {string[]} */
  const missing = [];
  for (let i = 0; i < REQUIRED_RELATIVE_FILES.length; i += 1) {
    if (!set.has(REQUIRED_RELATIVE_FILES[i])) {
      missing.push(REQUIRED_RELATIVE_FILES[i]);
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason_zh: 'ZIP 缺少必要檔案：' + missing.join(', '),
    };
  }
  return { ok: true };
}

/**
 * @param {object} manifest
 */
export function validate_manifest_member_paths(manifest) {
  /** @type {string[]} */
  const normalized = [];
  for (let i = 0; i < manifest.files.length; i += 1) {
    const check = normalize_and_validate_import_member_path(manifest.files[i].path);
    if (!check.ok) {
      return check;
    }
    normalized.push(check.normalized);
  }
  const collision = detect_case_insensitive_path_collisions(normalized);
  if (!collision.ok) {
    return collision;
  }
  return { ok: true, paths: normalized };
}

/**
 * @param {string} extract_root
 * @param {object} manifest
 */
export function verify_extract_has_no_extra_members(extract_root, manifest) {
  const allowed = new Set(['export-manifest.json']);
  for (let i = 0; i < manifest.files.length; i += 1) {
    allowed.add(manifest.files[i].path.replace(/\\/g, '/'));
  }

  /** @type {string[]} */
  const extras = [];
  /** @type {string[]} */
  const stack = [''];
  while (stack.length > 0) {
    const rel_dir = stack.pop();
    const abs_dir = rel_dir
      ? path.join(extract_root, rel_dir.split('/').join(path.sep))
      : extract_root;
    if (lstat_is_reparse_or_symlink(abs_dir)) {
      return { ok: false, reason_zh: '解壓目錄含 symlink／reparse：' + rel_dir };
    }
    const entries = fs.readdirSync(abs_dir, { withFileTypes: true });
    for (let i = 0; i < entries.length; i += 1) {
      const ent = entries[i];
      if (ent.isSymbolicLink()) {
        return { ok: false, reason_zh: '解壓含符號連結：' + ent.name };
      }
      const rel_posix = rel_dir ? rel_dir + '/' + ent.name : ent.name;
      if (ent.isDirectory()) {
        stack.push(rel_posix);
      } else if (ent.isFile()) {
        if (!allowed.has(rel_posix.replace(/\\/g, '/'))) {
          extras.push(rel_posix);
        }
      }
    }
  }

  if (extras.length > 0) {
    return {
      ok: false,
      reason_zh: 'ZIP 含未授權額外檔案：' + extras.slice(0, 5).join(', '),
    };
  }
  return { ok: true };
}

/**
 * @param {string} extract_root
 * @param {object} manifest
 */
export function run_full_import_extract_verification(extract_root, manifest) {
  const paths_check = validate_manifest_member_paths(manifest);
  if (!paths_check.ok) {
    return paths_check;
  }
  const req = validate_manifest_required_files(manifest);
  if (!req.ok) {
    return req;
  }
  const extra = verify_extract_has_no_extra_members(extract_root, manifest);
  if (!extra.ok) {
    return extra;
  }
  const hash_check = verify_extracted_tree_matches_manifest(manifest, extract_root);
  if (!hash_check.ok) {
    return hash_check;
  }
  return { ok: true };
}
