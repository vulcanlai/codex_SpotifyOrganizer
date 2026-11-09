/**
 * 確認指定 plan 後原子保存本機人工優先調整。不修改 Spotify。
 * 套用前只重抓 /me/playlists 清單指紋；來源已變則拒絕。
 * npm run playlists:apply -- --plan=<hash> --confirm=I_UNDERSTAND_MANAGED_PLAYLIST_APPLY
 */
import { MANAGED_PLAYLIST_APPLY_TOKEN } from '../lib/managed_playlists/constants.js';
import { apply_managed_playlist_plan } from '../lib/managed_playlists/apply_local.js';
import { create_spotify_get_json } from '../lib/managed_playlists/spotify_adapter.js';
import { fetch_live_list_fingerprint } from '../lib/managed_playlists/readback.js';

const argv = process.argv.slice(2);
let plan_hash = '';
let confirm = '';
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].indexOf('--plan=') === 0) {
    plan_hash = argv[i].slice('--plan='.length);
  }
  if (argv[i].indexOf('--confirm=') === 0) {
    confirm = argv[i].slice('--confirm='.length);
  }
}

if (!plan_hash || confirm !== MANAGED_PLAYLIST_APPLY_TOKEN) {
  console.error(
    '用法：npm run playlists:apply -- --plan=<hash> --confirm=' + MANAGED_PLAYLIST_APPLY_TOKEN
  );
  process.exit(1);
}

process.stderr.write('套用前核對 Spotify 歌單清單版本（不抓曲目、不寫入）…\n');
let live;
try {
  live = await fetch_live_list_fingerprint(create_spotify_get_json({}));
} catch (err) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        reason_zh: '無法核對來源清單版本，已拒絕套用：' + (err && err.message ? err.message : String(err)),
      },
      null,
      2
    )
  );
  process.exit(1);
}

const result = apply_managed_playlist_plan({
  plan_hash: plan_hash,
  confirm: confirm,
  account_id: live.account_id,
  current_live_list_fingerprint: live.live_list_fingerprint,
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
