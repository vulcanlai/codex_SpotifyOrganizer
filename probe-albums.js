/**
 * 收藏專輯 API 唯讀探測 CLI
 * 使用方式：npm run probe:albums
 * 不寫入 backup/，不修改 Spotify 線上資料
 */
import { get_client_id } from './lib/config.js';
import { load_tokens } from './lib/token_store.js';
import { run_albums_probe } from './lib/probe/albums_probe.js';

function print_albums_section(a) {
  console.log('\n--- GET /v1/me/albums?limit=5&offset=0 ---');
  if (!a.ok) {
    console.log('HTTP 狀態：', a.http_status != null ? a.http_status : '（非 HTTP）');
    console.log('結果：失敗');
    console.log('摘要：', a.message);
    if (a.spotify_error) {
      console.log(
        'Spotify error：',
        a.spotify_error.message || '(無訊息)',
        a.spotify_error.status != null ? `(status ${a.spotify_error.status})` : ''
      );
    }
    if (a.retry_after_sec) {
      console.log('Retry-After 建議等待（秒）：', a.retry_after_sec);
    }
    print_auth_hints(a.http_status);
    return;
  }

  console.log('HTTP 狀態：200');
  console.log('結果：成功');
  console.log('收藏專輯總數（API total）：', a.total != null ? a.total : '（未回傳）');
  console.log('本頁回傳項目數：', a.raw_item_count);

  if (!a.albums_preview.length) {
    console.log('前五張專輯：（無有效項目）');
    return;
  }

  console.log('前五張專輯（本頁有效項目）：');
  for (let i = 0; i < a.albums_preview.length; i += 1) {
    const p = a.albums_preview[i];
    console.log(
      `  ${p.index}. ${p.name || '(無名稱)'} | id=${p.album_id} | total_tracks=${p.total_tracks != null ? p.total_tracks : '?'}`
    );
  }
}

function print_tracks_section(t, skipped) {
  console.log('\n--- GET /v1/albums/{id}/tracks?limit=5&offset=0 ---');
  if (skipped) {
    console.log('略過：', skipped);
    return;
  }
  if (!t.ok) {
    console.log('HTTP 狀態：', t.http_status != null ? t.http_status : '（非 HTTP）');
    console.log('結果：失敗');
    console.log('專輯 ID：', t.album_id || '—');
    console.log('摘要：', t.message);
    if (t.spotify_error) {
      console.log(
        'Spotify error：',
        t.spotify_error.message || '(無訊息)'
      );
    }
    if (t.retry_after_sec) {
      console.log('Retry-After 建議等待（秒）：', t.retry_after_sec);
    }
    print_auth_hints(t.http_status);
    return;
  }

  console.log('HTTP 狀態：200');
  console.log('結果：成功');
  console.log('測試專輯 ID：', t.album_id);
  console.log('專輯曲目總數（API total）：', t.total != null ? t.total : '（未回傳）');
  if (!t.tracks_preview.length) {
    console.log('前五首：（無曲目或皆無 id）');
    return;
  }
  console.log('前五首：');
  for (let i = 0; i < t.tracks_preview.length; i += 1) {
    const tr = t.tracks_preview[i];
    console.log(
      `  ${tr.index}. ${tr.name || '(無名稱)'} | id=${tr.track_id || '?'}`
    );
  }
}

function print_auth_hints(http_status) {
  if (http_status === 401) {
    console.log(
      '\n排查：Token 可能已失效。請執行 npm start 重新授權（不需變更 scope）。'
    );
  } else if (http_status === 403) {
    console.log(
      '\n排查：403 常見原因 — Development Mode 限制、App 擁有者需 Premium、或 scope 不足。'
    );
    console.log(
      '目前預期 scope 含 user-library-read；若仍 403 請查 Spotify Dashboard 與 Dev Mode 政策。'
    );
  } else if (http_status === 429) {
    console.log('\n排查：請稍後再試，並遵守 Retry-After。');
  }
}

async function main() {
  try {
    get_client_id();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (!load_tokens()) {
    console.error('尚未授權。請先執行 npm start 完成 OAuth，再執行 npm run probe:albums。');
    process.exit(1);
  }

  console.log('Spotify 收藏專輯 API 唯讀探測（不寫入 backup/）');

  let result;
  try {
    result = await run_albums_probe();
  } catch (err) {
    console.error('探測中斷：', err && err.message ? err.message : err);
    process.exit(1);
  }

  print_albums_section(result.albums);
  print_tracks_section(result.tracks, result.tracks_skipped_reason);

  console.log('\n========== 探測結束 ==========\n');

  if (!result.albums.ok) {
    process.exitCode = 1;
  } else if (result.tracks && !result.tracks.ok) {
    process.exitCode = 1;
  }
}

main();
