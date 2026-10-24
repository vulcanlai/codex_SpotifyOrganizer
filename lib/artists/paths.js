/**
 * 追蹤藝人備份路徑（與收藏專輯 JSON 獨立）
 */
import path from 'node:path';
import { project_root } from '../config.js';

export const LIBRARY_DIR = path.join(project_root, 'backup', 'library');
export const FILE_FOLLOWED_ARTISTS = path.join(
  LIBRARY_DIR,
  'followed-artists.json'
);
export const FILE_FOLLOWED_SUMMARY = path.join(
  LIBRARY_DIR,
  'followed-artists-summary.json'
);
export const FILE_FOLLOWED_CHECKPOINT = path.join(
  LIBRARY_DIR,
  'followed-artists-checkpoint.json'
);

export const SCHEMA_VERSION = 1;

/** 追蹤藝人備份／探測所需 scope */
export const FOLLOWED_ARTISTS_SCOPES = ['user-follow-read'];
