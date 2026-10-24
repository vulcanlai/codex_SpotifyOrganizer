/**
 * E.1 可重建 hash
 */
import crypto from 'node:crypto';

export function stable_json_hash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}
