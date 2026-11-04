/**
 * 歌曲 metadata 批次補齊（串行、有上限）
 */
import { load_library_v2_for_probe } from '../probe/library_v2_select.js';
import { fetch_track_catalog, SpotifyRequestError } from '../spotify_api.js';
import { TrackApiBudgetExhaustedError } from './track_api_budget.js';
import { is_token_access_error } from '../auth/token_access_policy.js';
import {
  CACHE_SCHEMA_VERSION,
  CHECKPOINT_SCHEMA_VERSION,
  SUMMARY_SCHEMA_VERSION,
  ENRICH_MAX_PER_RUN,
} from './paths.js';
import { build_enrichment_queue } from './queue.js';
import {
  cache_entry_from_track_body,
  cache_entry_from_error,
  COOLDOWN_MS,
  iso_retry_after,
} from './track_entry.js';
import {
  load_track_cache,
  load_checkpoint,
  merge_cache_entry,
  persist_enrichment_state,
  count_cache_stats,
} from './storage.js';

export const ENRICH_FETCH_OPTS = {
  max_rate_retries: 2,
  max_retry_after_sec: 120,
  rate_limit_source: 'enrich:tracks',
};

function sleep_ms(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * 建立初始 run_stats
 */
export function create_run_stats(ctx) {
  return {
    v2_unique_total: ctx.v2_unique_total,
    v2_already_has_metadata: ctx.v2_already_has_metadata,
    still_need_enrichment: ctx.still_need_enrichment,
    planned_queries: ctx.planned_queries,
    run_success_ok: 0,
    run_partial: 0,
    run_not_found_404: 0,
    run_forbidden_403: 0,
    run_rate_limited_429: 0,
    run_network_error: 0,
    run_other_error: 0,
    run_metadata_success: 0,
    run_playable: 0,
    run_not_playable: 0,
    run_play_unknown: 0,
    track_api_attempts: 0,
    tracks_processed: 0,
  };
}

/**
 * 單批 enrichment（auto 與 enrich:tracks 共用）
 * @param {object} params
 */
export async function run_enrichment_batch(params) {
  const opts = params || {};
  const max_tracks = opts.max_tracks;
  const delay_ms = typeof opts.delay_ms === 'number' ? opts.delay_ms : 1000;
  const cache_doc = opts.cache_doc;
  const track_index = opts.track_index;
  const checkpoint_doc = opts.checkpoint_doc;
  const fetch_track = opts.fetch_track;
  const persist_fn = opts.persist_fn;
  const now_fn = opts.now_fn || function () {
    return Date.now();
  };
  const cooldowns = opts.cooldowns || COOLDOWN_MS;
  const abort_signal = opts.abort_signal;
  const get_attempt_count = opts.get_track_api_attempt_count;

  const now_ms = now_fn();
  const queue_info = build_enrichment_queue(
    track_index,
    cache_doc,
    now_ms,
    cooldowns,
    opts.queue_options
  );
  const to_process = queue_info.queue.slice(0, max_tracks);

  const run_stats = create_run_stats({
    v2_unique_total: opts.v2_unique_total,
    v2_already_has_metadata: queue_info.skipped_v2_has_meta,
    still_need_enrichment: queue_info.queue.length,
    planned_queries: to_process.length,
  });

  let safe_stopped = false;
  let stop_reason = null;
  let stop_entire_job = false;

  if (to_process.length === 0) {
    return {
      run_stats,
      safe_stopped: false,
      stop_reason: null,
      stop_entire_job: false,
      queue_remaining: 0,
    };
  }

  for (let i = 0; i < to_process.length; i += 1) {
    if (abort_signal && abort_signal.requested) {
      safe_stopped = true;
      stop_reason = '使用者中斷（Ctrl+C）';
      stop_entire_job = true;
      break;
    }

    if (get_attempt_count && opts.track_api_budget_remaining) {
      if (opts.track_api_budget_remaining() <= 0) {
        safe_stopped = true;
        stop_reason = 'Track API 查詢預算已用盡';
        stop_entire_job = true;
        break;
      }
    }

    const track_id = to_process[i];

    if (i > 0 && delay_ms > 0) {
      await sleep_ms(delay_ms);
    }

    let entry;
    opts.queue_options?.processed_ids?.add(track_id);
    try {
      const body = await fetch_track(track_id);
      entry = cache_entry_from_track_body(body);
      entry.spotify_id = entry.spotify_id || track_id;
    } catch (err) {
      // 身分／Token 存取問題不能當成歌曲網路錯誤繼續補全或寫入快取。
      if (is_token_access_error(err)) throw err;
      if (err instanceof TrackApiBudgetExhaustedError) {
        safe_stopped = true;
        stop_reason = err.message;
        stop_entire_job = true;
        break;
      }

      entry = handle_fetch_error(track_id, err, now_ms, cooldowns);
      classify_run_error(run_stats, entry);
      run_stats.tracks_processed += 1;

      merge_cache_entry(cache_doc, track_id, entry);
      checkpoint_doc.last_track_id_processed = track_id;
      sync_attempt_stats(run_stats, get_attempt_count);

      if (persist_fn) {
        try {
          persist_fn({
            cache_doc: {
              ...cache_doc,
              schema_version: CACHE_SCHEMA_VERSION,
            },
            checkpoint_doc,
            summary_doc: build_summary_placeholder(
              run_stats,
              cache_doc,
              safe_stopped,
              stop_reason
            ),
          });
        } catch (persist_err) {
          safe_stopped = true;
          stop_reason =
            persist_err && persist_err.message
              ? persist_err.message
              : '磁碟寫入失敗';
          stop_entire_job = true;
          break;
        }
      }

      if (entry.status === 'forbidden_403') {
        safe_stopped = true;
        stop_reason = 'HTTP 403，停止任務';
        stop_entire_job = true;
        break;
      }
      if (entry.status === 'rate_limited_429') {
        safe_stopped = true;
        stop_reason =
          entry.error_summary || 'HTTP 429 超過安全等待，停止任務';
        stop_entire_job = true;
        break;
      }
      continue;
    }

    classify_run_success(run_stats, entry);
    run_stats.tracks_processed += 1;
    merge_cache_entry(cache_doc, track_id, entry);
    checkpoint_doc.last_track_id_processed = track_id;
    sync_attempt_stats(run_stats, get_attempt_count);

    if (persist_fn) {
      try {
        persist_fn({
          cache_doc: {
            ...cache_doc,
            schema_version: CACHE_SCHEMA_VERSION,
          },
          checkpoint_doc,
          summary_doc: build_summary_placeholder(
            run_stats,
            cache_doc,
            safe_stopped,
            stop_reason
          ),
        });
      } catch (persist_err) {
        safe_stopped = true;
        stop_reason =
          persist_err && persist_err.message
            ? persist_err.message
            : '磁碟寫入失敗';
        stop_entire_job = true;
        break;
      }
    }
  }

  sync_attempt_stats(run_stats, get_attempt_count);

  const remaining = build_enrichment_queue(
    track_index,
    cache_doc,
    now_fn(),
    cooldowns,
    opts.queue_options
  ).queue.length;

  return {
    run_stats,
    safe_stopped,
    stop_reason,
    stop_entire_job,
    queue_remaining: remaining,
  };
}

function sync_attempt_stats(run_stats, get_attempt_count) {
  if (typeof get_attempt_count === 'function') {
    run_stats.track_api_attempts = get_attempt_count();
  }
}

/**
 * @param {object} params
 */
export async function run_track_enrichment(params) {
  const opts = params || {};
  const max = opts.max;
  if (typeof max !== 'number' || max < 1 || max > ENRICH_MAX_PER_RUN) {
    throw new Error(`max 必須在 1–${ENRICH_MAX_PER_RUN} 之間`);
  }

  const delay_ms = typeof opts.delay_ms === 'number' ? opts.delay_ms : 1000;
  const dry_run = opts.dry_run === true;
  const now_fn = opts.now_fn || function () {
    return Date.now();
  };
  const cooldowns = opts.cooldowns || COOLDOWN_MS;
  const fetch_track =
    opts.fetch_track ||
    function (id) {
      return fetch_track_catalog(id, {
        ...ENRICH_FETCH_OPTS,
        track_api_budget: opts.track_api_budget,
      });
    };
  const persist_fn = opts.persist_fn || persist_enrichment_state;

  const started_ms = now_fn();
  const loaded = load_library_v2_for_probe();
  const track_index = loaded.track_index;
  const v2_unique_total = Object.keys(track_index).length;

  let cache_doc = load_track_cache();
  const checkpoint_doc = load_checkpoint();

  const now_ms = now_fn();
  const queue_info = build_enrichment_queue(
    track_index,
    cache_doc,
    now_ms,
    cooldowns
  );
  const to_process = queue_info.queue.slice(0, max);

  if (dry_run) {
    const run_stats = create_run_stats({
      v2_unique_total,
      v2_already_has_metadata: queue_info.skipped_v2_has_meta,
      still_need_enrichment: queue_info.queue.length,
      planned_queries: to_process.length,
    });
    run_stats.remaining_after_run = queue_info.queue.length;
    return finalize_report({
      dry_run: true,
      safe_stopped: false,
      can_resume: queue_info.queue.length > 0,
      started_ms,
      finished_ms: now_fn(),
      cache_doc,
      checkpoint_doc,
      run_stats,
      stop_reason: null,
    });
  }

  checkpoint_doc.updated_at = new Date().toISOString();
  checkpoint_doc.last_run_started_at = checkpoint_doc.updated_at;
  checkpoint_doc.run_in_progress = true;
  checkpoint_doc.last_track_id_processed = null;

  const batch = await run_enrichment_batch({
    max_tracks: max,
    delay_ms,
    cache_doc,
    track_index,
    checkpoint_doc,
    fetch_track,
    persist_fn,
    now_fn,
    cooldowns,
    v2_unique_total,
    track_api_budget_remaining: opts.track_api_budget
      ? function () {
          return opts.track_api_budget.remaining();
        }
      : null,
    get_track_api_attempt_count: opts.track_api_budget
      ? function () {
          return opts.track_api_budget.consumed();
        }
      : null,
  });

  if (!opts.track_api_budget) {
    batch.run_stats.track_api_attempts = batch.run_stats.tracks_processed;
  }

  checkpoint_doc.run_in_progress = false;
  checkpoint_doc.last_run_finished_at = new Date().toISOString();
  checkpoint_doc.updated_at = checkpoint_doc.last_run_finished_at;

  batch.run_stats.remaining_after_run = batch.queue_remaining;

  const report = finalize_report({
    dry_run: false,
    safe_stopped: batch.safe_stopped,
    can_resume: batch.queue_remaining > 0,
    started_ms,
    finished_ms: now_fn(),
    cache_doc,
    checkpoint_doc,
    run_stats: batch.run_stats,
    stop_reason: batch.stop_reason,
  });

  persist_fn({
    cache_doc: report.cache_doc,
    checkpoint_doc: report.checkpoint_doc,
    summary_doc: report.summary_doc,
  });

  return report;
}

/**
 * @param {unknown} err
 */
function handle_fetch_error(track_id, err, now_ms, cooldowns) {
  if (err instanceof SpotifyRequestError) {
    const status = err.status;
    if (status === 404) {
      return cache_entry_from_error(track_id, {
        status: 'not_found_404',
        http_status: 404,
        message: err.message,
        next_retry_after: iso_retry_after(now_ms, cooldowns.not_found_404),
      });
    }
    if (status === 403) {
      return cache_entry_from_error(track_id, {
        status: 'forbidden_403',
        http_status: 403,
        message: err.message,
        next_retry_after: iso_retry_after(now_ms, cooldowns.forbidden_403),
      });
    }
    if (status === 429) {
      return cache_entry_from_error(track_id, {
        status: 'rate_limited_429',
        http_status: 429,
        message: err.message,
        next_retry_after: iso_retry_after(now_ms, cooldowns.rate_limited_429),
      });
    }
    if (status === 401) {
      return cache_entry_from_error(track_id, {
        status: 'other_error',
        http_status: 401,
        message: err.message,
        next_retry_after: iso_retry_after(now_ms, cooldowns.network_error),
      });
    }
    if (status === 0) {
      return cache_entry_from_error(track_id, {
        status: 'network_error',
        http_status: null,
        message: err.message,
        next_retry_after: iso_retry_after(now_ms, cooldowns.network_error),
      });
    }
    return cache_entry_from_error(track_id, {
      status: 'other_error',
      http_status: status,
      message: err.message,
      next_retry_after: iso_retry_after(now_ms, cooldowns.network_error),
    });
  }
  const msg = err && err.message ? err.message : String(err);
  return cache_entry_from_error(track_id, {
    status: 'network_error',
    http_status: null,
    message: msg,
    next_retry_after: iso_retry_after(now_ms, cooldowns.network_error),
  });
}

function classify_run_success(run_stats, entry) {
  if (entry.status === 'ok') {
    run_stats.run_success_ok += 1;
    run_stats.run_metadata_success += 1;
  } else if (entry.status === 'partial') {
    run_stats.run_partial += 1;
  }
  tally_playability(run_stats, entry);
}

function classify_run_error(run_stats, entry) {
  if (entry.status === 'not_found_404') {
    run_stats.run_not_found_404 += 1;
  } else if (entry.status === 'forbidden_403') {
    run_stats.run_forbidden_403 += 1;
  } else if (entry.status === 'rate_limited_429') {
    run_stats.run_rate_limited_429 += 1;
  } else if (entry.status === 'network_error') {
    run_stats.run_network_error += 1;
  } else {
    run_stats.run_other_error += 1;
  }
  tally_playability(run_stats, entry);
}

function tally_playability(run_stats, entry) {
  const ps = entry.playability_status;
  if (ps === 'playable') {
    run_stats.run_playable += 1;
  } else if (ps === 'not_playable' || ps === 'restricted') {
    run_stats.run_not_playable += 1;
  } else {
    run_stats.run_play_unknown += 1;
  }
}

function build_summary_placeholder(run_stats, cache_doc, safe_stopped, stop_reason) {
  const cache_stats = count_cache_stats(cache_doc);
  return {
    schema_version: SUMMARY_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    last_run: { ...run_stats, safe_stopped, stop_reason },
    cache_stats,
  };
}

function finalize_report(ctx) {
  const cache_stats = count_cache_stats(ctx.cache_doc);
  const duration_ms = ctx.finished_ms - ctx.started_ms;

  const summary_doc = {
    schema_version: SUMMARY_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    dry_run: ctx.dry_run,
    duration_ms,
    safe_stopped: ctx.safe_stopped,
    can_resume: ctx.can_resume,
    stop_reason: ctx.stop_reason,
    v2_unique_total: ctx.run_stats.v2_unique_total,
    v2_already_has_metadata: ctx.run_stats.v2_already_has_metadata,
    still_need_enrichment: ctx.run_stats.still_need_enrichment,
    planned_queries: ctx.run_stats.planned_queries,
    api_calls: ctx.run_stats.track_api_attempts,
    run: ctx.run_stats,
    cache_stats,
  };

  const checkpoint_doc = ctx.checkpoint_doc;
  checkpoint_doc.schema_version = CHECKPOINT_SCHEMA_VERSION;

  const cache_doc = ctx.cache_doc;
  cache_doc.schema_version = CACHE_SCHEMA_VERSION;

  return {
    ...ctx,
    summary_doc,
    cache_stats,
    duration_ms,
  };
}

export function print_enrichment_report(report) {
  console.log('\n========== Track Metadata Enrichment ==========');
  if (report.dry_run) {
    console.log('模式：dry-run（未呼叫 Spotify API）');
  }
  console.log('V2 不重複歌曲：', report.run_stats.v2_unique_total);
  console.log(
    'V2 已有歌名/藝人/專輯（非僅 ID）：',
    report.run_stats.v2_already_has_metadata
  );
  console.log(
    '仍需補齊（執行前佇列）：',
    report.run_stats.still_need_enrichment
  );
  console.log('本次預計查詢：', report.run_stats.planned_queries);
  if (!report.dry_run) {
    console.log(
      'Track API attempts：',
      report.run_stats.track_api_attempts
    );
    console.log('本次 ok：', report.run_stats.run_success_ok);
    console.log('本次 partial：', report.run_stats.run_partial);
    console.log('本次 404：', report.run_stats.run_not_found_404);
    console.log('本次 403：', report.run_stats.run_forbidden_403);
    console.log('本次 429：', report.run_stats.run_rate_limited_429);
    console.log('本次 network：', report.run_stats.run_network_error);
    console.log('本次其他錯誤：', report.run_stats.run_other_error);
    console.log('--- 播放狀態（本次寫入列）---');
    console.log('  可播放：', report.run_stats.run_playable);
    console.log('  不可播放/受限：', report.run_stats.run_not_playable);
    console.log('  未知：', report.run_stats.run_play_unknown);
  }
  console.log('--- 快取累計 ---');
  console.log('  快取列數：', report.cache_stats.cached_entries);
  console.log('  完整 metadata（ok）：', report.cache_stats.cache_ok_complete);
  console.log(
    '  剩餘待補齊（佇列）：',
    report.run_stats.remaining_after_run != null
      ? report.run_stats.remaining_after_run
      : report.run_stats.still_need_enrichment
  );
  console.log('耗時（ms）：', report.duration_ms);
  console.log('安全停止：', report.safe_stopped ? '是' : '否');
  if (report.stop_reason) {
    console.log('停止原因：', report.stop_reason);
  }
  console.log('可續傳：', report.can_resume ? '是' : '否');
  console.log('===============================================\n');
}
