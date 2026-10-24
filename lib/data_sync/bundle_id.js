/**
 * 交接 bundle 識別（不依檔案 mtime）
 */
import crypto from 'node:crypto';

/**
 * @param {object} manifest
 */
export function compute_bundle_id_from_manifest(manifest) {
  const payload = {
    manifest_schema_version: manifest.manifest_schema_version,
    profile: manifest.profile,
    files: (manifest.files || [])
      .map(function (f) {
        return { path: f.path, size: f.size, sha256: f.sha256 };
      })
      .sort(function (a, b) {
        return a.path.localeCompare(b.path);
      }),
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex');
}

/**
 * @param {string} manifest_json_text
 */
export function hash_manifest_file_sha256(manifest_json_text) {
  return crypto.createHash('sha256').update(manifest_json_text, 'utf8').digest('hex');
}
