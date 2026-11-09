/**
 * 唯讀讀回 🎵 歌單，產生可審核 plan 與報告。不修改 Spotify、不保存正式規則。
 * npm run playlists:preview
 */
import { create_spotify_get_json } from '../lib/managed_playlists/spotify_adapter.js';
import { run_managed_playlist_readback } from '../lib/managed_playlists/readback.js';
import { catalog_track_ids_by_spotify_id } from '../lib/managed_playlists/diff.js';
import { load_full_library_inference } from '../lib/classification/full_library_inference.js';
import {
  build_mvp_playlist_catalog,
  load_classification_index_for_mvp,
} from '../lib/classification/mvp_smart_playlists.js';
import { load_sync_manifest } from '../lib/classification/mvp_playlist_sync_manifest.js';

const argv = process.argv.slice(2);
if (argv.indexOf('--apply') >= 0) {
  console.error('此指令只做唯讀預覽。確認保存請用 npm run playlists:apply');
  process.exit(1);
}

let excluded = [];
try {
  const inference = load_full_library_inference();
  if (inference && Array.isArray(inference.excluded_track_ids)) {
    excluded = inference.excluded_track_ids;
  }
} catch {
  excluded = [];
}

let catalog_map = {};
try {
  process.stderr.write('載入本機分類索引以標示推定差異（不打 Spotify Track API）…\n');
  catalog_map = catalog_track_ids_by_spotify_id(
    build_mvp_playlist_catalog(load_classification_index_for_mvp()),
    load_sync_manifest()
  );
} catch (err) {
  process.stderr.write('分類索引無法比對：' + (err && err.message ? err.message : String(err)) + '\n');
}

process.stderr.write('正在以既有 OAuth 做唯讀讀回（不修改 Spotify、不保存正式規則）…\n');
const result = await run_managed_playlist_readback({
  get_json: create_spotify_get_json({}),
  excluded_track_ids: excluded,
  resume: argv.indexOf('--resume') >= 0,
  catalog_track_ids_by_spotify_id: catalog_map,
});

console.log('=== 🎵 歌單讀回預覽（未保存）===');
console.log('帳號：', result.account_id);
console.log('plan hash：', result.plan_hash);
console.log('報告：', result.report_path);
console.log('JSON：', result.plan_path);
console.log('可套用：', result.plan.apply_supported === true);
console.log('摘要：', JSON.stringify(result.plan.summary, null, 2));
console.log('人工基準：', JSON.stringify(result.plan.human_baseline, null, 2));
console.log('讀取成本：', JSON.stringify(result.read_cost, null, 2));
console.log('');
console.log('尚未確認保存。檢查報告後：');
console.log(
  'npm run playlists:apply -- --plan=' +
    result.plan_hash +
    ' --confirm=I_UNDERSTAND_MANAGED_PLAYLIST_APPLY'
);
