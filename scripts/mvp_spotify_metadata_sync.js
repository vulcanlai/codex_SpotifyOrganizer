/**
 * 僅更新 manifest 內已建立 Spotify 歌單的名稱／描述（不碰曲目）
 *
 * node scripts/mvp_spotify_metadata_sync.js
 * node scripts/mvp_spotify_metadata_sync.js --apply --authorize=I_UNDERSTAND_MVP_SPOTIFY_METADATA_SYNC
 */
import {
  build_mvp_metadata_update_plan,
  run_mvp_metadata_update_apply,
  run_mvp_metadata_manifest_reconcile,
  MVP_SPOTIFY_METADATA_SYNC_AUTHORIZE_TOKEN,
} from '../lib/classification/mvp_playlist_metadata_sync.js';

const argv = process.argv.slice(2);
const apply = argv.indexOf('--apply') >= 0;
const manifest_reconcile_only = argv.indexOf('--manifest-reconcile-only') >= 0;
const names_only = argv.indexOf('--names-only') >= 0;
const emotion_only = argv.indexOf('--emotion-only') >= 0;
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

const sync_opts = {
  names_only: names_only,
  emotion_only: emotion_only,
};
if (playlist_id) {
  sync_opts.playlist_id = playlist_id;
}

if (manifest_reconcile_only) {
  const out = run_mvp_metadata_manifest_reconcile({
    authorize: authorize,
    ...sync_opts,
  });
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

if (apply) {
  const out = await run_mvp_metadata_update_apply({
    authorize: authorize,
    ...sync_opts,
  });
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const plan = build_mvp_metadata_update_plan(sync_opts);
console.log('=== MVP Spotify 歌單 metadata dry-run ===');
if (playlist_id) {
  console.log('篩選 playlist_id：', playlist_id);
}
if (plan.emotion_only) {
  console.log('範圍：僅 emotion:* 歌單');
}
if (plan.names_only) {
  console.log('模式：僅更新名稱（不寫入描述）');
}
console.log('manifest 歌單列數：', plan.manifest_playlist_rows);
console.log('預計更新：', plan.change_count, '張');
console.log('  其中改名：', plan.name_change_count);
console.log('  其中更新描述：', plan.description_change_count);
console.log('預估 API 請求（PUT）：', plan.estimated_api_requests);
console.log('scope 足夠：', plan.scopes_ok);
if (!plan.scopes_ok) {
  console.log('缺少 scope：', plan.missing_scopes.join(', '));
  console.log(plan.reauth_hint_zh);
}
console.log('\n正式更新：');
console.log(
  '  node scripts/mvp_spotify_metadata_sync.js --apply --authorize=' +
    MVP_SPOTIFY_METADATA_SYNC_AUTHORIZE_TOKEN
);
console.log('\n變更清單：');
for (let c = 0; c < plan.changes.length; c += 1) {
  const ch = plan.changes[c];
  console.log('---');
  console.log(ch.mvp_playlist_id, '|', ch.spotify_playlist_id);
  if (ch.update_name) {
    console.log('  名稱：', JSON.stringify(ch.current_name), '→', JSON.stringify(ch.target_name));
  }
  if (ch.update_description) {
    console.log('  描述：將更新（長度', ch.current_description.length, '→', ch.target_description.length, '）');
  }
}
if (plan.skipped.length) {
  console.log('\n略過：', plan.skipped.length, '（多為已符合或無 Spotify ID）');
}
