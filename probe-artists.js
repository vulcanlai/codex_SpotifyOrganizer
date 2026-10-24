/**
 * 追蹤藝人 API 唯讀探測
 * npm run probe:artists
 */
import { get_client_id } from './lib/config.js';
import { run_with_oauth } from './lib/oauth_session.js';
import { run_artists_probe } from './lib/probe/artists_probe.js';
import { FOLLOWED_ARTISTS_SCOPES } from './lib/artists/paths.js';
import { has_all_scopes, get_missing_scopes } from './lib/auth/scopes.js';

function print_auth_hints(http_status) {
  if (http_status === 401) {
    console.log(
      '\n排查：Token 可能已失效。請重新執行本指令並完成瀏覽器授權。'
    );
  } else if (http_status === 403) {
    console.log(
      '\n排查：403 常見原因 — scope 不足（需 user-follow-read）或 Dev Mode 限制。'
    );
    const missing = get_missing_scopes(FOLLOWED_ARTISTS_SCOPES);
    if (missing.length) {
      console.log('目前 token 仍缺少：', missing.join(', '));
    }
  } else if (http_status === 429) {
    console.log('\n排查：請稍後再試，並遵守 Retry-After。');
  }
}

function print_section(r) {
  console.log('\n--- GET /v1/me/following?type=artist&limit=5 ---');
  if (!r.ok) {
    console.log(
      'HTTP 狀態：',
      r.http_status != null ? r.http_status : '（非 HTTP）'
    );
    console.log('結果：失敗');
    console.log('摘要：', r.message);
    if (r.spotify_error) {
      console.log(
        'Spotify error：',
        r.spotify_error.message || '(無訊息)'
      );
    }
    print_auth_hints(r.http_status);
    return;
  }

  console.log('HTTP 狀態：200');
  console.log('結果：成功');
  console.log('含 artists.items：', r.has_artists_items ? '是' : '否');
  console.log(
    '含 artists.cursors.after：',
    r.has_cursors_after ? '是' : '否（可能已是最後一頁或總數≤5）'
  );
  console.log('含 artists.next：', r.has_next ? '是' : '否');
  console.log(
    '追蹤藝人總數（API total）：',
    r.total != null ? r.total : '（未回傳）'
  );
  console.log('本頁回傳項目數：', r.raw_item_count);

  if (!r.artists_preview || !r.artists_preview.length) {
    console.log('前五名藝人：（無有效項目）');
    return;
  }
  console.log('前五名藝人：');
  for (let i = 0; i < r.artists_preview.length; i += 1) {
    const p = r.artists_preview[i];
    console.log(
      `  ${p.index}. ${p.name || '(無名稱)'} | id=${p.artist_id || '?'} | uri=${p.uri || '?'}`
    );
  }
}

async function main() {
  try {
    get_client_id();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  console.log('Spotify 追蹤藝人 API 唯讀探測（不寫入 backup/）');

  if (!has_all_scopes(FOLLOWED_ARTISTS_SCOPES)) {
    console.log(
      '\n[OAuth] 需要追加 user-follow-read。即將啟動本機 callback 並開啟瀏覽器授權。'
    );
    console.log(
      '步驟：1) 在瀏覽器登入 Spotify 並同意權限  2) 看到「授權成功」後回到終端機\n'
    );
  }

  let result;
  try {
    await run_with_oauth(async function () {
      result = await run_artists_probe();
    }, FOLLOWED_ARTISTS_SCOPES);
  } catch (err) {
    console.error('探測中斷：', err && err.message ? err.message : err);
    process.exit(1);
  }

  print_section(result);
  console.log('\n========== 探測結束 ==========\n');

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main();
