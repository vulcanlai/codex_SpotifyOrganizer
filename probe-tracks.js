/**
 * 歌曲 Metadata API 唯讀探測
 * npm run probe:tracks
 * 不修改 backup/ 任何檔案
 */
import { get_client_id } from './lib/config.js';
import { run_with_oauth } from './lib/oauth_session.js';
import { run_tracks_probe, PROBE_TRACKS_MAX } from './lib/probe/tracks_probe.js';
import { LibraryV2ProbeError } from './lib/probe/library_v2_select.js';
import {
  assert_cli_may_query_track_api,
  try_backfill_rate_limit_state_from_cache,
  GlobalRateLimitCooldownError,
  GlobalRateLimitStateError,
} from './lib/enrichment/rate_limit_state.js';

function print_track_result(row, index) {
  console.log(`\n--- [${index + 1}] ${row.endpoint} ---`);
  console.log('Track ID：', row.track_id);
  if (!row.ok) {
    console.log(
      'HTTP 狀態：',
      row.http_status != null ? row.http_status : '（非 HTTP／網路）'
    );
    console.log('結果：失敗');
    console.log('摘要：', row.message);
    if (row.spotify_error) {
      console.log(
        'Spotify error：',
        row.spotify_error.message || '(無訊息)'
      );
    }
    if (row.retry_after_sec != null) {
      console.log('Retry-After（秒）：', row.retry_after_sec);
    }
    return;
  }

  console.log('HTTP 狀態：200');
  console.log('結果：成功（≠ 保證可播放）');
  const m = row.metadata;
  console.log('歌名：', m.name != null ? m.name : '（null）');
  console.log(
    '藝人：',
    m.artists && m.artists.length
      ? m.artists
          .map(function (a) {
            return `${a.name || '?'} (${a.id || 'no-id'})`;
          })
          .join(', ')
      : '（無）'
  );
  if (m.album) {
    console.log(
      '專輯：',
      `${m.album.name || '?'} | id=${m.album.id || '?'} | release=${m.album.release_date || '?'} (${m.album.release_date_precision || '?'})`
    );
  } else {
    console.log('專輯：（無 album 物件）');
  }
  console.log('曲長 ms：', m.duration_ms != null ? m.duration_ms : 'null');
  console.log('explicit：', m.explicit != null ? m.explicit : 'null');
  console.log('disc / track：', m.disc_number, '/', m.track_number);
  console.log('is_playable：', m.is_playable != null ? m.is_playable : 'null');
  console.log('playability_status：', m.playability_status);
  if (m.restrictions) {
    console.log('restrictions：', m.restrictions);
  }
  console.log('popularity：', m.popularity != null ? m.popularity : 'null');
  console.log('isrc：', m.isrc != null ? m.isrc : 'null');
  console.log('preview_url：', m.preview_url != null ? '(有值)' : 'null');
}

function print_summary(report) {
  console.log('\n========== Track Metadata Probe 摘要 ==========');
  console.log('模式：', report.endpoint_mode);
  console.log('最多查詢：', report.max_queries);
  console.log('實際查詢：', report.queries_attempted);
  if (report.id_only_pool_size != null) {
    console.log('library-v2 僅 ID 歌曲池：', report.id_only_pool_size);
  }
  console.log('成功：', report.success_count);
  console.log('失敗：', report.fail_count);
  if (report.stopped_early) {
    console.log('提前停止：', report.stop_reason);
  }
  console.log('（未寫入任何 backup 檔案）');
  console.log('===============================================\n');
}

async function main() {
  try {
    get_client_id();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  console.log(
    `Spotify Track Metadata 探測（最多 ${PROBE_TRACKS_MAX} 首，唯讀 library-v2）`
  );

  try {
    try_backfill_rate_limit_state_from_cache();
    assert_cli_may_query_track_api('probe:tracks', { dry_run: false });
  } catch (err) {
    if (
      err instanceof GlobalRateLimitCooldownError ||
      err instanceof GlobalRateLimitStateError
    ) {
      process.exit(1);
    }
    throw err;
  }

  let report;
  try {
    await run_with_oauth(async function () {
      report = await run_tracks_probe();
    });
  } catch (err) {
    if (err instanceof LibraryV2ProbeError) {
      console.error('\n', err.message);
    } else {
      console.error(
        '\n探測中斷：',
        err && err.message ? err.message : err
      );
    }
    process.exit(1);
  }

  for (let i = 0; i < report.results.length; i += 1) {
    print_track_result(report.results[i], i);
  }
  print_summary(report);

  if (report.fail_count > 0 && report.success_count === 0) {
    process.exitCode = 1;
  }
}

main();
