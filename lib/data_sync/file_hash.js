/**
 * 檔案 SHA-256（串流讀取，不修改來源）
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * @param {string} abs_path
 * @returns {Promise<{ size: number, sha256: string }>}
 */
export function hash_file_sha256(abs_path) {
  return new Promise(function (resolve, reject) {
    const hash = crypto.createHash('sha256');
    let size = 0;
    const stream = fs.createReadStream(abs_path);
    stream.on('data', function (chunk) {
      size += chunk.length;
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', function () {
      resolve({ size: size, sha256: hash.digest('hex') });
    });
  });
}

/**
 * @param {string} abs_path
 * @returns {{ size: number, sha256: string }}
 */
export function hash_file_sha256_sync(abs_path) {
  const buf = fs.readFileSync(abs_path);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  return { size: buf.length, sha256: hash };
}
