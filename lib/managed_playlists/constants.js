/**
 * 🎵 納管歌單：路徑、schema、確認旗標與狀態列舉。
 * 正式規則與讀回快取必須分離；確認前不得覆寫正式基準。
 */
import path from 'node:path';
import { project_root } from '../config.js';

export const MANAGED_PLAYLIST_PREFIX = '🎵';
export const MANAGED_PLAYLIST_RULES_SCHEMA = 1;
export const MANAGED_PLAYLIST_BASELINE_SCHEMA = 1;
export const MANAGED_PLAYLIST_PLAN_SCHEMA = 1;
export const MANAGED_PLAYLIST_OPS_SCHEMA = 1;

export const MANAGED_PLAYLIST_APPLY_TOKEN = 'I_UNDERSTAND_MANAGED_PLAYLIST_APPLY';
export const RELATION_IMPORT_APPLY_TOKEN = 'I_UNDERSTAND_RELATION_IMPORT_APPLY';

export const PLAYLIST_STATUS_ACTIVE = 'active';
export const PLAYLIST_STATUS_PREFIX_REMOVED = 'prefix_removed_pending';
export const PLAYLIST_STATUS_UNFOLLOWED = 'unfollowed_pending';
export const PLAYLIST_STATUS_DELETED = 'deleted_pending';
export const PLAYLIST_STATUS_UNREADABLE = 'unreadable_pending';
export const PLAYLIST_STATUS_PERMISSION = 'permission_changed_pending';
export const PLAYLIST_STATUS_READONLY_FOREIGN = 'readonly_foreign';

export const ITEM_KIND_TRACK = 'track';
export const ITEM_KIND_EPISODE = 'episode';
export const ITEM_KIND_LOCAL = 'local';
export const ITEM_KIND_UNAVAILABLE = 'unavailable';

export const KIND_TEMPLATE = 'template';
export const KIND_CUSTOM = 'custom';

export const PRIORITY_HUMAN_NAME = 'human_retained_name';
export const PRIORITY_HUMAN_REMOVE = 'human_remove_per_playlist';
export const PRIORITY_HUMAN_ADD = 'human_add_and_custom_content';
export const PRIORITY_LEDGER_REMOVE = 'cleanup_ledger_verified_remove';
export const PRIORITY_AUTO_CLASSIFY = 'algorithm_classification';

export function managed_playlist_paths(root) {
  const base = path.join(root || project_root, 'backup', 'classification');
  const readback = path.join(base, 'managed-playlists-readback');
  return {
    rules: path.join(base, 'managed-playlist-rules.json'),
    baseline: path.join(base, 'managed-playlist-baseline.json'),
    operations: path.join(base, 'managed-playlist-operations.json'),
    readback_dir: readback,
    checkpoint: path.join(readback, 'checkpoint.json'),
    latest_plan: path.join(readback, 'latest-plan.json'),
    plans_dir: path.join(readback, 'plans'),
    reports_dir: path.join(readback, 'reports'),
    cache_dir: path.join(readback, 'cache'),
    cache_list: path.join(readback, 'cache', 'playlist-list.json'),
    cache_items_dir: path.join(readback, 'cache', 'items'),
  };
}

export const DEFAULT_MANAGED_PATHS = managed_playlist_paths();
