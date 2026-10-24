/**
 * 完整音樂庫整合 V2（僅本機 JSON）
 * npm run merge:library-v2
 */
import { publish_library_v2 } from './lib/merge/v2/publish.js';
import { MergeV2SourceError } from './lib/merge/v2/validate_sources.js';

function print_summary(s) {
  console.log('\n========== library-v2 合併摘要 ==========');
  console.log(
    'library_v2_merge_complete：',
    s.library_v2_merge_complete ? '是' : '否'
  );
  console.log('不重複歌曲（V2）：', s.counts.unique_tracks_by_spotify_id);
  console.log('V1 不重複歌曲：', s.counts.unique_tracks_v1);
  console.log(
    '專輯新增 unique ID：',
    s.counts.new_unique_track_ids_from_albums
  );
  console.log('播放清單曲目筆數：', s.counts.playlist_track_entries);
  console.log('已按讚筆數：', s.counts.liked_tracks);
  console.log('收藏專輯曲目筆數：', s.counts.saved_album_track_entries);
  console.log('來源出現次數合計：', s.counts.source_occurrences_total);
  console.log('appearances 總數：', s.counts.appearances_total);
  console.log('收藏專輯數：', s.counts.saved_albums);
  console.log('追蹤藝人數：', s.counts.followed_artists);
  console.log('\n--- Metadata ---');
  console.log('有歌名：', s.metadata.with_name);
  console.log('有藝人：', s.metadata.with_artists);
  console.log('有發行日期：', s.metadata.with_release_date);
  console.log('僅 Spotify ID：', s.metadata.id_only);
  console.log('播放狀態 unknown：', s.metadata.playability_unknown);
  console.log('metadata 衝突數：', s.metadata.metadata_conflicts);
  if (s.metadata_conflicts && s.metadata_conflicts.length) {
    console.log('（前 3 筆衝突已寫入 merge-summary-v2.json）');
  }
  console.log('========================================\n');
}

async function main() {
  console.log('開始合併 library-v2（不呼叫 Spotify API）…');

  try {
    const summary = publish_library_v2();
    print_summary(summary);
    if (!summary.library_v2_merge_complete) {
      process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof MergeV2SourceError) {
      console.error('\n合併停止：', err.message);
      if (err.details && err.details.length) {
        for (let i = 0; i < err.details.length; i += 1) {
          console.error('  ', err.details[i]);
        }
      }
    } else {
      console.error('\n合併失敗：', err && err.message ? err.message : err);
    }
    process.exit(1);
  }
}

main();
