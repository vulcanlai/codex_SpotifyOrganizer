/**
 * 階段 G1：外部資料查證（獨立於 Spotify enrichment 快取）
 */
import path from 'node:path';
import { ENRICHMENT_DIR } from '../paths.js';
import { G1_TRIAL_DIR } from './g1_path_resolve.js';

export const EXTERNAL_DIR = path.join(ENRICHMENT_DIR, 'external');
/** 正式試驗目錄（同 G1_TRIAL_DIR） */
export const G1_DIR = G1_TRIAL_DIR;

export {
  G1_TRIAL_DIR,
  active_g1_data_dir,
  file_g1_sample,
  file_g1_selection_manifest,
  file_g1_query_cache,
  file_g1_verification,
  file_g1_progress,
  file_g1_quality_report,
} from './g1_path_resolve.js';

export const G1_SCHEMA_VERSION = 1;
export const G1_SAMPLE_ID = 'g1-ext-verify-v1';
export const G1_TARGET_COUNT = 30;

/** MusicBrainz：官方建議 ≤1 req/s，保留安全邊際 */
export const MB_MIN_INTERVAL_MS = 1100;
export const MB_MAX_RETRIES = 3;
export const MB_USER_AGENT =
  'SpotifyOrganizer/1.0 (local library organizer; contact: local-dev)';

export const VERIFY_STATUS = {
  pending: 'pending',
  cached: 'cached',
  candidates_found: 'candidates_found',
  matched: 'matched',
  ambiguous: 'ambiguous',
  not_found: 'not_found',
  insufficient: 'insufficient',
  error: 'error',
  skipped: 'skipped',
};
