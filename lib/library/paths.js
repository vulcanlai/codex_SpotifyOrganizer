/**
 * 收藏專輯備份路徑（獨立於 backup/ 根目錄 API 備份）
 */
import path from 'node:path';
import { project_root } from '../config.js';

export const LIBRARY_DIR = path.join(project_root, 'backup', 'library');
export const FILE_SAVED_ALBUMS = path.join(LIBRARY_DIR, 'saved-albums.json');
export const FILE_ALBUM_TRACKS = path.join(LIBRARY_DIR, 'album-tracks.json');
export const FILE_LIBRARY_SUMMARY = path.join(LIBRARY_DIR, 'library-summary.json');
export const FILE_CHECKPOINT = path.join(LIBRARY_DIR, 'library-checkpoint.json');

export const SCHEMA_VERSION = 1;
