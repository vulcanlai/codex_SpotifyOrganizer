/**
 * Spotify OAuth PKCE 本機伺服器入口
 * 監聽 127.0.0.1:8888，處理 /callback 並測試 Web API
 */
import { get_client_id } from './lib/config.js';
import { run_with_oauth } from './lib/oauth_session.js';
import {
  fetch_current_user,
  fetch_all_playlists,
  fetch_all_saved_tracks,
  SpotifyRequestError,
} from './lib/spotify_api.js';

/**
 * 呼叫 /me、歌單、已按讚歌曲並輸出摘要
 */
async function run_api_tests() {
  console.log('--- Spotify API 測試 ---\n');

  let profile;
  try {
    profile = await fetch_current_user();
  } catch (err) {
    print_api_error('取得使用者資料 (/v1/me)', err);
    throw err;
  }

  const display_name =
    profile.display_name || profile.id || '(未知使用者)';
  console.log(`使用者：${display_name}（id: ${profile.id}）`);

  let playlists_result;
  try {
    playlists_result = await fetch_all_playlists();
  } catch (err) {
    print_api_error('讀取歌單 (/v1/me/playlists)', err);
    throw err;
  }

  const playlist_count = playlists_result.items.length;
  const playlist_total_hint =
    playlists_result.total_from_api !== null
      ? `（API total: ${playlists_result.total_from_api}，分頁 ${playlists_result.pages} 次）`
      : `（分頁 ${playlists_result.pages} 次）`;
  console.log(`歌單數量：${playlist_count} ${playlist_total_hint}`);

  let tracks_result;
  try {
    tracks_result = await fetch_all_saved_tracks();
  } catch (err) {
    print_api_error('讀取已按讚歌曲 (/v1/me/tracks)', err);
    throw err;
  }

  const saved_count = tracks_result.items.length;
  const tracks_total_hint =
    tracks_result.total_from_api !== null
      ? `（API total: ${tracks_result.total_from_api}，分頁 ${tracks_result.pages} 次）`
      : `（分頁 ${tracks_result.pages} 次）`;
  console.log(`已按讚歌曲數量：${saved_count} ${tracks_total_hint}`);

  console.log('\n--- 測試完成 ---');
}

/**
 * @param {string} label
 * @param {unknown} err
 */
function print_api_error(label, err) {
  if (err instanceof SpotifyRequestError) {
    console.error(`\n[錯誤] ${label}：${err.message}`);
    if (err.status === 429 && err.retry_after_sec) {
      console.error(`建議 ${err.retry_after_sec} 秒後再試。`);
    }
    return;
  }
  console.error(`\n[錯誤] ${label}：`, err && err.message ? err.message : err);
}

async function main() {
  try {
    get_client_id();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  try {
    await run_with_oauth(run_api_tests);
  } catch (err) {
    console.error('\n流程結束（發生錯誤）。');
    if (err && err.message) {
      console.error(err.message);
    }
    process.exitCode = 1;
  }
}

main();
