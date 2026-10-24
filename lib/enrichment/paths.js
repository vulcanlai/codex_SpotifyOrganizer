/**
 * Metadata enrichment 快取路徑
 */
import path from 'node:path';
import { project_root } from '../config.js';

export const ENRICHMENT_DIR = path.join(project_root, 'backup', 'enrichment');
export const FILE_TRACK_CACHE = path.join(
  ENRICHMENT_DIR,
  'track-metadata-cache.json'
);
export const FILE_CHECKPOINT = path.join(ENRICHMENT_DIR, 'checkpoint.json');
export const FILE_SUMMARY = path.join(ENRICHMENT_DIR, 'summary.json');
export const FILE_AUTO_RUN_SUMMARY = path.join(
  ENRICHMENT_DIR,
  'auto-run-summary.json'
);
export const FILE_PROCESS_LOCK = path.join(ENRICHMENT_DIR, '.enrich.lock');
export const FILE_RATE_LIMIT_STATE = path.join(
  ENRICHMENT_DIR,
  'rate-limit-state.json'
);

export const CACHE_SCHEMA_VERSION = 1;
export const CHECKPOINT_SCHEMA_VERSION = 1;
export const SUMMARY_SCHEMA_VERSION = 1;

/** 單次執行硬上限（需使用者同意才可調高） */
export const ENRICH_MAX_PER_RUN = 50;

/** enrich:auto 單次 Track API 總預算上限 */
export const ENRICH_AUTO_MAX_TOTAL = 2000;

/** enrich:auto 預設批次大小與批次間休息（秒） */
export const ENRICH_AUTO_DEFAULT_BATCH_SIZE = 50;
export const ENRICH_AUTO_DEFAULT_BATCH_PAUSE_SEC = 30;

/** 預設請求間隔（毫秒） */
export const DEFAULT_DELAY_MS = 1000;

export const ENRICH_AUTO_MIN_DELAY_MS = 1000;

export const AUTO_RUN_SCHEMA_VERSION = 1;
