/**
 * MVP 智慧歌單 → Spotify 同步
 * 預設 dry-run（不呼叫寫入 API）
 *
 * node scripts/mvp_spotify_sync.js
 * node scripts/mvp_spotify_sync.js --apply --authorize=I_UNDERSTAND_MVP_SPOTIFY_SYNC
 */
import {
  run_mvp_spotify_sync_dry_run,
  run_mvp_spotify_sync_apply,
  MVP_SPOTIFY_SYNC_AUTHORIZE_TOKEN,
} from '../lib/classification/mvp_playlist_sync.js';

const argv = process.argv.slice(2);
const apply = argv.indexOf('--apply') >= 0;
let authorize = '';
let playlist_id = '';
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].indexOf('--authorize=') === 0) {
    authorize = argv[i].slice('--authorize='.length);
  }
  if (argv[i].indexOf('--playlist-id=') === 0) {
    playlist_id = argv[i].slice('--playlist-id='.length);
  }
}

const sync_opts = playlist_id ? { playlist_id: playlist_id } : {};

if (apply) {
  const out = await run_mvp_spotify_sync_apply({
    authorize: authorize,
    ...sync_opts,
  });
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const plan = run_mvp_spotify_sync_dry_run(sync_opts);
console.log('=== MVP Spotify 同步 dry-run ===');
if (playlist_id) {
  console.log('篩選 playlist_id：', playlist_id);
}
console.log('歌單數：', plan.playlist_count);
console.log('有效 URI 總數：', plan.total_valid_uris);
console.log('排除（無效 ID／重複）：', plan.total_invalid_or_excluded);
console.log('預估 API 請求：', plan.estimated_api_requests);
console.log('  建立歌單：', plan.estimated_create_requests);
console.log('  批次加入：', plan.estimated_add_batch_requests);
console.log('scope 足夠：', plan.scopes_ok);
if (!plan.scopes_ok) {
  console.log('缺少 scope：', plan.missing_scopes.join(', '));
  console.log(plan.reauth_hint_zh);
}
console.log('\n首次線上建立：');
console.log(
  '  1) 確認 .env 與 OAuth；npm start 重新授權（需 playlist-modify-private）'
);
console.log(
  '  2) node scripts/mvp_spotify_sync.js --apply --authorize=' +
    MVP_SPOTIFY_SYNC_AUTHORIZE_TOKEN
);
console.log('中斷後續跑：再次執行 --apply（manifest 會跳過已完成、補齊未加入 URI）');
console.log('\n各歌單：');
for (let p = 0; p < plan.playlists.length; p += 1) {
  const pl = plan.playlists[p];
  console.log(
    ' ',
    pl.mvp_playlist_id,
    '|',
    pl.spotify_name,
    '| valid',
    pl.valid_uri_count,
    '| API',
    pl.estimated_api_requests
  );
}
