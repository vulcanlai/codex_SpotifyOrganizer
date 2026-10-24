/**
 * 讀取 backup/playlists.json 目錄
 */
import fs from 'node:fs';
import path from 'node:path';
import { project_root } from '../config.js';

export function load_playlist_catalog() {
  const catalog_path = path.join(project_root, 'backup', 'playlists.json');
  if (!fs.existsSync(catalog_path)) {
    return { catalog: [], user_id: null, by_id: {} };
  }
  const doc = JSON.parse(fs.readFileSync(catalog_path, 'utf8'));
  const catalog = Array.isArray(doc.playlists) ? doc.playlists : [];
  /** @type {Record<string, object>} */
  const by_id = {};
  for (let i = 0; i < catalog.length; i += 1) {
    if (catalog[i] && catalog[i].id) {
      by_id[catalog[i].id] = catalog[i];
    }
  }
  return {
    catalog,
    user_id: doc.user_id || null,
    by_id,
  };
}
