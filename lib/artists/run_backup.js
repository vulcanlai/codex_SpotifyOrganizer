/**
 * 追蹤藝人唯讀備份
 */
import {
  fetch_followed_artists_page,
  fetch_current_user,
  SpotifyRequestError,
} from '../spotify_api.js';
import {
  collect_all_followed_artists,
  FollowedArtistsPaginationError,
} from './fetch_followed.js';
import {
  normalize_followed_artist,
  dedupe_followed_artists,
} from './normalize.js';
import {
  load_existing_followed_artists,
  persist_followed_artists_backup,
  should_replace_followed_artists_file,
  detect_unfollowed_since_last,
} from './storage.js';
import { SCHEMA_VERSION } from './paths.js';

/**
 * @param {unknown} err
 */
function error_record(err) {
  if (err instanceof SpotifyRequestError) {
    return {
      status: err.status,
      message: err.message,
      spotify_error: err.body || null,
    };
  }
  if (err instanceof FollowedArtistsPaginationError) {
    return {
      status: null,
      message: err.message,
      pages_before_fail: err.pages,
      items_collected: err.items_collected,
    };
  }
  return {
    status: null,
    message: err && err.message ? err.message : String(err),
  };
}

/**
 * @param {object} summary
 */
export function print_followed_artists_summary(summary) {
  console.log('\n========== 追蹤藝人備份摘要 ==========');
  console.log(
    'followed_artists_backup_complete：',
    summary.followed_artists_backup_complete ? '是' : '否'
  );
  console.log(
    '追蹤藝人數（本次成功寫入）：',
    summary.artists_written != null ? summary.artists_written : '—'
  );
  console.log(
    '分頁數：',
    summary.pages_fetched != null ? summary.pages_fetched : '—'
  );
  console.log(
    '缺少 artist_id 筆數：',
    summary.missing_artist_id_count != null
      ? summary.missing_artist_id_count
      : '—'
  );
  if (summary.preserved_previous_complete_backup) {
    console.log(
      '注意：本次失敗或未完整，已保留上一次完整 followed-artists.json。'
    );
  }
  if (summary.errors && summary.errors.length) {
    console.log('錯誤筆數：', summary.errors.length);
    for (let i = 0; i < summary.errors.length && i < 3; i += 1) {
      console.log('  -', summary.errors[i].message || summary.errors[i]);
    }
  }
  console.log('======================================\n');
}

/**
 * 主備份流程
 */
export async function run_followed_artists_backup() {
  const started_at = new Date().toISOString();
  const errors = [];

  let user_id = null;
  try {
    const user = await fetch_current_user();
    user_id = user && user.id ? user.id : null;
  } catch (err) {
    errors.push({ phase: 'user_profile', ...error_record(err) });
  }

  const existing = load_existing_followed_artists();
  const previous_for_compare =
    existing && existing.pagination_complete === true ? existing : null;

  let fetch_failed = false;
  let pagination_complete = false;
  let pages_fetched = 0;
  let total_from_api = null;
  /** @type {unknown[]} */
  let raw_items = [];

  try {
    const result = await collect_all_followed_artists(function (after) {
      return fetch_followed_artists_page(after, 50);
    });
    raw_items = result.items;
    pages_fetched = result.pages;
    total_from_api = result.total_from_api;
    pagination_complete = result.pagination_complete === true;
  } catch (err) {
    fetch_failed = true;
    pagination_complete = false;
    errors.push({ phase: 'followed_artists_list', ...error_record(err) });
    if (err instanceof FollowedArtistsPaginationError) {
      pages_fetched = err.pages;
    }
  }

  let missing_artist_id_count = 0;
  /** @type {object[]} */
  let artists_normalized = [];

  if (!fetch_failed && pagination_complete) {
    for (let i = 0; i < raw_items.length; i += 1) {
      const row = normalize_followed_artist(raw_items[i], i);
      if (!row.artist_id) {
        missing_artist_id_count += 1;
      }
      artists_normalized.push(row);
    }
    artists_normalized = dedupe_followed_artists(artists_normalized);
    for (let j = 0; j < artists_normalized.length; j += 1) {
      artists_normalized[j].list_index = j;
    }
  }

  const unfollowed_info = detect_unfollowed_since_last(
    previous_for_compare,
    artists_normalized
  );

  const followed_artists_backup_complete =
    !fetch_failed && pagination_complete;

  const run_state = { pagination_complete, fetch_failed };
  const write_artists_file = should_replace_followed_artists_file(
    run_state,
    existing
  );

  const backed_up_at = new Date().toISOString();
  /** @type {object|null} */
  let artists_doc = null;
  if (write_artists_file) {
    artists_doc = {
      schema_version: SCHEMA_VERSION,
      backed_up_at,
      started_at,
      source_api: 'GET /v1/me/following?type=artist',
      user_id,
      artists: artists_normalized,
      artist_count: artists_normalized.length,
      total_from_api,
      pages_fetched,
      pagination_complete: true,
      missing_artist_id_count,
    };
  }

  const preserved_previous_complete_backup =
    !write_artists_file &&
    previous_for_compare != null &&
    (fetch_failed || !pagination_complete);

  const summary_doc = {
    schema_version: SCHEMA_VERSION,
    updated_at: backed_up_at,
    started_at,
    followed_artists_backup_complete,
    artists_written: write_artists_file ? artists_normalized.length : null,
    pages_fetched: fetch_failed ? pages_fetched : pages_fetched,
    total_from_api,
    missing_artist_id_count: write_artists_file ? missing_artist_id_count : null,
    fetch_failed,
    pagination_complete: write_artists_file ? true : pagination_complete,
    preserved_previous_complete_backup,
    unfollowed_since_last_complete: unfollowed_info.compared
      ? unfollowed_info.unfollowed_artist_ids
      : null,
    errors,
  };

  const checkpoint_doc = {
    schema_version: SCHEMA_VERSION,
    updated_at: backed_up_at,
    phase: followed_artists_backup_complete ? 'complete' : 'incomplete',
    pages_fetched,
    items_collected: raw_items.length,
    pagination_complete: followed_artists_backup_complete,
    last_error: errors.length ? errors[errors.length - 1] : null,
  };

  persist_followed_artists_backup(
    {
      artists_doc,
      summary_doc,
      checkpoint_doc,
    },
    { write_artists_file: write_artists_file && artists_doc != null }
  );

  return summary_doc;
}
