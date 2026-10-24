/**
 * G3-B.5.1 全庫名稱覆蓋診斷（衍生資料）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_B51_DIAG_DIR = path.join(CLASSIFICATION_DIR, 'g3-b5-1-diagnostic');

export const FILE_B51_TITLE_COVERAGE = path.join(G3_B51_DIAG_DIR, 'title-coverage-summary.json');
export const FILE_B51_EXCLUSION_COUNTS = path.join(G3_B51_DIAG_DIR, 'exclusion-reason-counts.json');
export const FILE_B51_EXCLUSION_INDEX = path.join(G3_B51_DIAG_DIR, 'exclusion-track-index.jsonl');
export const FILE_B51_OFFLINE_BACKFILL = path.join(G3_B51_DIAG_DIR, 'offline-backfill-candidates.json');
export const FILE_B51_NEEDS_SPOTIFY_API = path.join(G3_B51_DIAG_DIR, 'needs-spotify-api-track-ids.json');
export const FILE_B51_POOL_FIX_SUGGESTIONS = path.join(G3_B51_DIAG_DIR, 'sampling-pool-fix-suggestions.json');
export const FILE_B51_SAMPLE_100_IMPACT = path.join(G3_B51_DIAG_DIR, 'sample-100-impact-assessment.json');
export const FILE_B51_OFFLINE_SUMMARY = path.join(G3_B51_DIAG_DIR, 'offline-summary.json');

export const B51_SCHEMA_VERSION = 1;
