/**
 * 匯入 Dry Run 預覽統計
 */
import fs from 'node:fs';
import path from 'node:path';
import { hash_file_sha256_sync } from './file_hash.js';
import { REQUIRED_RELATIVE_FILES } from './export_profile_minimal.js';

/**
 * @param {string} project_root
 * @param {object} manifest
 */
export function build_import_preview(project_root, manifest) {
  let would_add = 0;
  let would_overwrite = 0;
  let identical = 0;
  /** @type {{ path: string, local_sha256: string | null, incoming_sha256: string }[]} */
  const file_rows = [];

  for (let i = 0; i < manifest.files.length; i += 1) {
    const f = manifest.files[i];
    const abs = path.join(project_root, f.path.split('/').join(path.sep));
    let local_sha = null;
    if (fs.existsSync(abs)) {
      local_sha = hash_file_sha256_sync(abs).sha256;
    }
    file_rows.push({
      path: f.path,
      local_sha256: local_sha,
      incoming_sha256: f.sha256,
    });
    if (!local_sha) {
      would_add += 1;
    } else if (local_sha === f.sha256) {
      identical += 1;
    } else {
      would_overwrite += 1;
    }
  }

  let project_has_sync_relevant_files = false;
  for (let j = 0; j < REQUIRED_RELATIVE_FILES.length; j += 1) {
    const req = REQUIRED_RELATIVE_FILES[j];
    const abs = path.join(project_root, req.split('/').join(path.sep));
    if (fs.existsSync(abs)) {
      project_has_sync_relevant_files = true;
      break;
    }
  }
  if (!project_has_sync_relevant_files) {
    for (let k = 0; k < manifest.files.length; k += 1) {
      const abs = path.join(
        project_root,
        manifest.files[k].path.split('/').join(path.sep)
      );
      if (fs.existsSync(abs)) {
        project_has_sync_relevant_files = true;
        break;
      }
    }
  }

  return {
    would_add: would_add,
    would_overwrite: would_overwrite,
    identical: identical,
    conflict_or_anomaly: 0,
    file_rows: file_rows,
    project_has_sync_relevant_files: project_has_sync_relevant_files,
  };
}
