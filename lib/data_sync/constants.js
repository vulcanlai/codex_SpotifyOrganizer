/**
 * 資料同步匯出：版本識別與安全常數
 */
import path from 'node:path';

/** export-manifest.json 格式版本 */
export const EXPORT_MANIFEST_SCHEMA_VERSION = 1;

/** 資料交接語意版本（供未來 import 比對） */
export const DATA_TRANSFER_VERSION = '1.0.0';

/** 正式環境允許的專案根目錄（兩台電腦皆為此路徑） */
export const CANONICAL_PROJECT_ROOT = path.resolve('D:\\SpotifyOrganizer');

/**
 * 絕對禁止讀寫／掃描的 Windows 路徑前綴（大小寫不敏感）
 * @type {string[]}
 */
export const FORBIDDEN_ABSOLUTE_ROOTS = [
  path.resolve('D:\\workCase'),
  path.resolve('D:\\vulcan-project-skills'),
];

/** 專案內匯出 ZIP 允許放置的子目錄（避免把輸出檔再打包） */
export const IN_PROJECT_ZIP_OUTPUT_DIR = '.data-sync-out';

/** 匯出過程暫存目錄（不納入 minimal profile） */
export const EXPORT_STAGING_DIR = '.data-sync-staging';

/** 測試用：允許覆寫專案根目錄的環境變數 */
export const ENV_ALLOW_PROJECT_ROOT_OVERRIDE = 'DATA_SYNC_ALLOW_PROJECT_ROOT_OVERRIDE';

/** 測試用：允許以 stdin 餵給 7-Zip -p（正式匯出不得使用） */
export const ENV_ALLOW_7Z_PASSWORD_STDIN = 'DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN';

/** 使用者手動指定 7z.exe 絕對路徑（選用；不掃描磁碟） */
export const ENV_SEVEN_ZIP_EXECUTABLE = 'SPOTIFY_ORGANIZER_7Z_PATH';

/** 匯入交接狀態目錄（專案內，已 .gitignore） */
export const SYNC_STATE_DIR = '.data-sync-state';

/** 匯入前備份目錄 */
export const PRE_IMPORT_BACKUP_DIR = '.data-sync-pre-import-backup';

/** 匯入解壓暫存（非正式 backup） */
export const IMPORT_STAGING_DIR = '.data-sync-import-staging';

export const SYNC_STATE_SCHEMA_VERSION = 1;

export const IMPORT_STATE_FILENAME = 'last-import.json';

export const EXPORT_STATE_FILENAME = 'last-export.json';

/** 正式匯入確認 token */
export const IMPORT_APPLY_CONFIRM_TOKEN = 'I_UNDERSTAND_DATA_SYNC_IMPORT';
