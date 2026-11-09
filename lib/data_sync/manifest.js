/**
 * export-manifest.json 建立
 */
import {
  DATA_TRANSFER_VERSION,
  EXPORT_MANIFEST_SCHEMA_VERSION,
} from './constants.js';

/**
 * @param {object} params
 * @param {string} params.exported_at_iso
 * @param {string | null} params.source_git_commit
 * @param {string} params.profile
 * @param {{ relative_path: string, size: number, sha256: string }[]} params.entries
 * @param {string | null} [params.handoff_previous_bundle_id]
 */
export function build_export_manifest(params) {
  let total_bytes = 0;
  for (let i = 0; i < params.entries.length; i += 1) {
    total_bytes += params.entries[i].size;
  }

  /** @type {Record<string, unknown>} */
  const doc = {
    manifest_schema_version: EXPORT_MANIFEST_SCHEMA_VERSION,
    data_transfer_version: DATA_TRANSFER_VERSION,
    exported_at: params.exported_at_iso,
    source_git_commit: params.source_git_commit,
    profile: params.profile,
    file_count: params.entries.length,
    total_bytes: total_bytes,
    handoff_previous_bundle_id:
      params.handoff_previous_bundle_id != null
        ? params.handoff_previous_bundle_id
        : null,
    mirror_supported: params.mirror_supported === true,
    files: params.entries.map(function (e) {
      return {
        path: e.relative_path,
        size: e.size,
        sha256: e.sha256,
      };
    }),
  };
  return doc;
}
