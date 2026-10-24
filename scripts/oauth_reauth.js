/**
 * 強制走 OAuth 同意畫面（補齊 config 內 scope，例如 playlist-modify-private）
 * 成功前不覆寫 token；成功後由 callback 寫入新 token。
 *
 * npm run oauth:reauth
 */
import { run_with_oauth } from '../lib/oauth_session.js';
import {
  MVP_SPOTIFY_SYNC_SCOPES,
  get_mvp_sync_missing_scopes,
  has_mvp_sync_scopes,
} from '../lib/auth/mvp_sync_scopes.js';

await run_with_oauth(async function () {
  if (has_mvp_sync_scopes()) {
    console.log('\n[OAuth] 已具備智慧歌單同步所需 scope。');
  } else {
    console.log(
      '\n[OAuth] 仍缺少：',
      get_mvp_sync_missing_scopes().join(', ')
    );
  }
}, MVP_SPOTIFY_SYNC_SCOPES);

console.log('\n重新授權流程結束。');
