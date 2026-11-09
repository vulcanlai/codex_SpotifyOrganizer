/**
 * 名稱與曲目版本分開指紋；筆數相同不代表內容相同。
 */
import { createHash } from 'node:crypto';

export function sha256_json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function name_fingerprint(name) {
  return sha256_json(typeof name === 'string' ? name : '');
}

/**
 * @param {object[]} items
 */
export function items_fingerprint(items) {
  const rows = (items || []).map(function (item) {
    return [
      item.uri || null,
      item.kind || null,
      item.track_id || null,
      item.occurrence || 1,
    ];
  });
  return sha256_json(rows);
}

export function playlist_content_fingerprint(name, snapshot_id, items) {
  return sha256_json({
    name: typeof name === 'string' ? name : '',
    snapshot_id: snapshot_id || null,
    items: items_fingerprint(items),
  });
}

export function plan_body_hash(plan) {
  const copy = { ...plan };
  delete copy.plan_hash;
  return sha256_json(copy);
}
