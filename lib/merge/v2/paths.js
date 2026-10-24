/**
 * library-v2 輸出路徑（不覆寫 library.json）
 */
import path from 'node:path';
import { project_root } from '../../config.js';

export const BACKUP_DIR = path.join(project_root, 'backup');
export const MERGED_DIR = path.join(BACKUP_DIR, 'merged');
export const LIBRARY_DIR = path.join(BACKUP_DIR, 'library');

export const FILE_LIBRARY_V1 = path.join(MERGED_DIR, 'library.json');
export const FILE_MERGE_SUMMARY_V1 = path.join(MERGED_DIR, 'merge-summary.json');

export const FILE_SAVED_ALBUMS = path.join(LIBRARY_DIR, 'saved-albums.json');
export const FILE_ALBUM_TRACKS = path.join(LIBRARY_DIR, 'album-tracks.json');
export const FILE_LIBRARY_SUMMARY = path.join(LIBRARY_DIR, 'library-summary.json');

export const FILE_FOLLOWED_ARTISTS = path.join(
  LIBRARY_DIR,
  'followed-artists.json'
);
export const FILE_FOLLOWED_SUMMARY = path.join(
  LIBRARY_DIR,
  'followed-artists-summary.json'
);

export const FILE_LIBRARY_V2 = path.join(MERGED_DIR, 'library-v2.json');
export const FILE_MERGE_SUMMARY_V2 = path.join(
  MERGED_DIR,
  'merge-summary-v2.json'
);

export const SCHEMA_VERSION_V2 = 2;
export const SCHEMA_VERSION_V1 = 1;
