/**
 * Metadata 自動分批控制器
 */
import fs from 'node:fs';
import { load_library_v2_for_probe } from '../probe/library_v2_select.js';
import { fetch_track_catalog } from '../spotify_api.js';
import { create_track_api_budget } from './track_api_budget.js';
import {
  AUTO_RUN_SCHEMA_VERSION,
  CACHE_SCHEMA_VERSION,
  CHECKPOINT_SCHEMA_VERSION,
  SUMMARY_SCHEMA_VERSION,
  FILE_AUTO_RUN_SUMMARY,
} from './paths.js';
import { build_enrichment_queue } from './queue.js';
import { COOLDOWN_MS } from './track_entry.js';
import {
  load_track_cache,
  load_checkpoint,
  persist_enrichment_state,
  count_cache_stats,
} from './storage.js';
import {
  run_enrichment_batch,
  create_run_stats,
  ENRICH_FETCH_OPTS,
} from './run_enrich.js';
import { write_json_atomic } from '../atomic_json.js';
import { ENRICHMENT_DIR } from './paths.js';

function sleep_ms(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * 可中斷等待（Ctrl+C）
 * @param {number} ms
 * @param {{ requested?: boolean }} abort_signal
 */
export async function sleep_interruptible(ms, abort_signal) {
  const step = 500;
  let left = ms;
  while (left > 0) {
    if (abort_signal && abort_signal.requested) {
      return false;
    }
    const chunk = left > step ? step : left;
    await sleep_ms(chunk);
    left -= chunk;
  }
  return true;
}

/**
 * @param {object} opts
 */
export function plan_auto_enrichment(opts) {
  const loaded = opts.state || load_library_v2_for_probe();
  const track_index = loaded.track_index;
  const cache_doc = opts.state ? opts.state.cache_doc : load_track_cache();
  const now_ms = (opts.now_fn || Date.now)();
  const queue_info = build_enrichment_queue(
    track_index,
    cache_doc,
    now_ms,
    COOLDOWN_MS,
    { phase: opts.retry_failed ? 'retry' : 'normal' }
  );

  const queue_len = queue_info.queue.length;
  const planned_track_slots = Math.min(opts.total, queue_len);
  const batch_size = opts.batch_size;
  const batch_count =
    planned_track_slots === 0
      ? 0
      : Math.ceil(planned_track_slots / batch_size);

  const cache_stats = count_cache_stats(cache_doc);

  return {
    phase: opts.retry_failed ? 'retry' : 'normal',
    normal_pending: queue_info.normal_pending,
    anomalous_pending: queue_info.anomalous_pending,
    deferred_anomalies: queue_info.deferred_anomalies,
    cooldown_anomalies: queue_info.cooldown_anomalies,
    remaining_total: queue_info.remaining_total,
    v2_unique_total: Object.keys(track_index).length,
    v2_already_has_metadata: queue_info.skipped_v2_has_meta,
    queue_len,
    cache_ok_complete: cache_stats.cache_ok_complete,
    skipped_cache_ok: queue_info.skipped_cache_ok,
    skipped_cooldown: queue_info.skipped_cooldown,
    api_budget_total: opts.total,
    planned_track_slots,
    planned_batches: batch_count,
    batch_size,
    batch_pause_sec: opts.batch_pause_sec,
    delay_ms: opts.delay_ms,
  };
}

/**
 * @param {object} params
 */
export async function run_auto_enrichment(params) {
  const opts = params || {};
  const state = opts.state || {
    track_index: load_library_v2_for_probe().track_index,
    cache_doc: load_track_cache(),
    checkpoint_doc: load_checkpoint(),
  };
  const { track_index, cache_doc, checkpoint_doc } = state;
  const now_fn = opts.now_fn || Date.now;
  const plan = plan_auto_enrichment({ ...opts, state });
  // 一次 auto job 共用，不受批次重建佇列或冷卻到期影響。
  const queue_options = { phase: plan.phase, processed_ids: new Set() };
  const get_progress = () => build_enrichment_queue(
    track_index, cache_doc, now_fn(), COOLDOWN_MS, queue_options
  );

  const aggregate = create_run_stats({
    v2_unique_total: plan.v2_unique_total,
    v2_already_has_metadata: plan.v2_already_has_metadata,
    still_need_enrichment: plan.queue_len,
    planned_queries: plan.planned_track_slots,
  });

  const started_ms = Date.now();

  if (opts.dry_run) {
    return build_auto_report({
      dry_run: true,
      started_ms,
      finished_ms: Date.now(),
      plan,
      aggregate,
      batches: [],
      budget: create_track_api_budget(opts.total),
      safe_stopped: false,
      stop_reason: null,
      can_resume: plan.remaining_total > 0,
      progress: get_progress(),
      cache_doc,
      checkpoint_doc,
      abort_signal: opts.abort_signal,
    });
  }

  checkpoint_doc.updated_at = new Date().toISOString();
  checkpoint_doc.last_auto_run_started_at = checkpoint_doc.updated_at;
  checkpoint_doc.run_in_progress = true;

  const budget = create_track_api_budget(opts.total);
  const batches = [];
  let safe_stopped = false;
  let stop_reason = null;
  let batch_index = 0;

  while (budget.remaining() > 0) {
    if (opts.abort_signal && opts.abort_signal.requested) {
      safe_stopped = true;
      stop_reason = '使用者中斷（Ctrl+C）';
      break;
    }

    const remaining_budget = budget.remaining();
    const batch_limit = Math.min(opts.batch_size, remaining_budget);
    const queue_len = get_progress().queue.length;

    if (queue_len === 0) {
      stop_reason = stop_reason || '本階段可處理佇列已清空（未完成歌曲請見摘要）';
      break;
    }

    batch_index += 1;
    console.log(
      `\n[auto] 批次 ${batch_index}／預估 ${plan.planned_batches}，本批最多 ${batch_limit} 首，預算剩餘 ${remaining_budget}`
    );

    const fetch_track = opts.fetch_track
      ? function (id) {
          return opts.fetch_track(id, {
            ...ENRICH_FETCH_OPTS,
            track_api_budget: budget,
          });
        }
      : function (id) {
          return fetch_track_catalog(id, {
            ...ENRICH_FETCH_OPTS,
            rate_limit_source: 'enrich:auto',
            track_api_budget: budget,
          });
        };

    const batch_result = await run_enrichment_batch({
      max_tracks: batch_limit,
      delay_ms: opts.delay_ms,
      cache_doc,
      track_index,
      checkpoint_doc,
      fetch_track,
      persist_fn: opts.persist_fn || persist_enrichment_state,
      cooldowns: COOLDOWN_MS,
      queue_options,
      now_fn,
      abort_signal: opts.abort_signal,
      v2_unique_total: plan.v2_unique_total,
      track_api_budget_remaining: function () {
        return budget.remaining();
      },
      get_track_api_attempt_count: function () {
        return budget.consumed();
      },
    });

    merge_aggregate(aggregate, batch_result.run_stats);
    batches.push({
      batch_index,
      ...batch_result.run_stats,
      safe_stopped: batch_result.safe_stopped,
      stop_reason: batch_result.stop_reason,
    });

    print_batch_progress({
      batch_index,
      plan,
      budget,
      aggregate,
      cache_doc,
      batch_result,
    });

    if (batch_result.stop_entire_job || batch_result.safe_stopped) {
      safe_stopped = batch_result.safe_stopped;
      stop_reason = batch_result.stop_reason;
      break;
    }

    if (batch_result.queue_remaining === 0) {
      stop_reason = stop_reason || '本階段可處理佇列已清空（未完成歌曲請見摘要）';
      break;
    }

    if (budget.remaining() <= 0) {
      stop_reason = stop_reason || 'Track API 查詢預算已用盡';
      break;
    }

    const pause_ms = opts.batch_pause_sec * 1000;
    if (pause_ms > 0) {
      console.log(
        `[auto] 批次間休息 ${opts.batch_pause_sec} 秒…（Ctrl+C 可安全停止）`
      );
      const cont = await sleep_interruptible(pause_ms, opts.abort_signal);
      if (!cont) {
        safe_stopped = true;
        stop_reason = '使用者中斷（Ctrl+C）';
        break;
      }
    }
  }

  checkpoint_doc.run_in_progress = false;
  checkpoint_doc.last_auto_run_finished_at = new Date().toISOString();
  checkpoint_doc.updated_at = checkpoint_doc.last_auto_run_finished_at;

  aggregate.track_api_attempts = budget.consumed();
  const progress = get_progress();
  aggregate.remaining_after_run = progress.remaining_total;

  const finished_ms = Date.now();
  const report = build_auto_report({
    dry_run: false,
    started_ms,
    finished_ms,
    plan,
    aggregate,
    batches,
    budget,
    safe_stopped,
    stop_reason,
    can_resume: aggregate.remaining_after_run > 0,
    abort_signal: opts.abort_signal,
    cache_doc,
    checkpoint_doc,
    progress,
  });

  try {
    if (opts.persist_fn) {
      opts.persist_fn({
        cache_doc: report.cache_doc,
        checkpoint_doc: report.checkpoint_doc,
        summary_doc: report.summary_doc,
      });
    } else {
      persist_enrichment_state({
        cache_doc: report.cache_doc,
        checkpoint_doc: report.checkpoint_doc,
        summary_doc: report.summary_doc,
      });
    }
  } catch (persist_err) {
    report.safe_stopped = true;
    report.stop_reason =
      persist_err && persist_err.message
        ? persist_err.message
        : '磁碟寫入失敗';
    report.auto_run_doc.safe_stopped = report.safe_stopped;
    report.auto_run_doc.stop_reason = report.stop_reason;
  }

  if (!opts.dry_run) {
    try {
      if (opts.write_auto_summary_fn) {
        opts.write_auto_summary_fn(report.auto_run_doc);
      } else {
        if (!fs.existsSync(ENRICHMENT_DIR)) {
          fs.mkdirSync(ENRICHMENT_DIR, { recursive: true });
        }
        write_json_atomic(FILE_AUTO_RUN_SUMMARY, report.auto_run_doc);
      }
    } catch (write_err) {
      report.safe_stopped = true;
      report.stop_reason =
        write_err && write_err.message ? write_err.message : '摘要寫入失敗';
    }
  }

  return report;
}

function merge_aggregate(agg, batch_stats) {
  const keys = [
    'run_success_ok',
    'run_partial',
    'run_not_found_404',
    'run_forbidden_403',
    'run_rate_limited_429',
    'run_network_error',
    'run_other_error',
    'run_metadata_success',
    'run_playable',
    'run_not_playable',
    'run_play_unknown',
    'tracks_processed',
  ];
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    agg[k] += batch_stats[k] || 0;
  }
}

function print_batch_progress(ctx) {
  const cache_stats = count_cache_stats(ctx.cache_doc);
  console.log(
    `[auto] 本批 ok=${ctx.batch_result.run_stats.run_success_ok} 404=${ctx.batch_result.run_stats.run_not_found_404} 429=${ctx.batch_result.run_stats.run_rate_limited_429}`
  );
  console.log(
    `[auto] 預算 ${ctx.budget.consumed()}/${ctx.budget.total} | 快取 ok=${cache_stats.cache_ok_complete} | 待補齊=${ctx.batch_result.queue_remaining}`
  );
}

function build_auto_report(ctx) {
  const cache_doc = ctx.cache_doc || load_track_cache();
  const checkpoint_doc =
    ctx.checkpoint_doc ||
    load_checkpoint();
  const cache_stats = count_cache_stats(cache_doc);
  const duration_ms = ctx.finished_ms - ctx.started_ms;
  const progress = {
    phase: ctx.plan.phase,
    normal_pending: ctx.progress.normal_pending,
    anomalous_pending: ctx.progress.anomalous_pending,
    deferred_anomalies: ctx.progress.deferred_anomalies,
    cooldown_anomalies: ctx.progress.cooldown_anomalies,
    eligible_remaining: ctx.progress.queue.length,
    remaining_total: ctx.progress.remaining_total,
    run_success: ctx.aggregate.run_success_ok,
    run_failed: ctx.aggregate.tracks_processed - ctx.aggregate.run_success_ok,
  };
  ctx.aggregate.remaining_after_run = progress.remaining_total;

  const summary_doc = {
    schema_version: SUMMARY_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    dry_run: ctx.dry_run,
    duration_ms,
    safe_stopped: ctx.safe_stopped,
    can_resume: ctx.can_resume,
    stop_reason: ctx.stop_reason,
    mode: 'auto',
    api_calls: ctx.aggregate.track_api_attempts,
    run: ctx.aggregate,
    cache_stats,
    progress,
  };

  cache_doc.schema_version = CACHE_SCHEMA_VERSION;
  checkpoint_doc.schema_version = CHECKPOINT_SCHEMA_VERSION;

  const auto_run_doc = {
    schema_version: AUTO_RUN_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    dry_run: ctx.dry_run,
    duration_ms,
    plan: ctx.plan,
    api_budget: {
      total: ctx.budget.total,
      consumed: ctx.budget.consumed(),
      remaining: ctx.budget.remaining(),
    },
    batches: ctx.batches,
    aggregate: ctx.aggregate,
    safe_stopped: ctx.safe_stopped,
    stop_reason: ctx.stop_reason,
    can_resume: ctx.can_resume,
    cache_stats,
    progress,
  };

  return {
    dry_run: ctx.dry_run,
    plan: ctx.plan,
    aggregate: ctx.aggregate,
    batches: ctx.batches,
    budget: ctx.budget,
    cache_stats,
    progress,
    duration_ms,
    safe_stopped: ctx.safe_stopped,
    stop_reason: ctx.stop_reason,
    can_resume: ctx.can_resume,
    cache_doc,
    checkpoint_doc,
    summary_doc,
    auto_run_doc,
  };
}

export function print_auto_enrichment_report(report) {
  console.log('\n========== Auto Metadata Enrichment ==========');
  if (report.dry_run) {
    console.log('模式：dry-run（未呼叫 API、未寫入檔案）');
  }
  console.log('API 預算上限：', report.plan.api_budget_total);
  console.log('補全階段：', report.plan.phase === 'retry' ? '異常重試' : '正常補全（只查無快取歌曲）');
  console.log('正常待補全：', report.progress.normal_pending);
  console.log('異常未完成總數：', report.progress.anomalous_pending);
  console.log('延後處理的異常：', report.progress.deferred_anomalies);
  console.log('冷卻中的異常（包含於延後數）：', report.progress.cooldown_anomalies);
  console.log('本次成功／失敗：', report.progress.run_success, '/', report.progress.run_failed);
  console.log('全部剩餘（含延後與冷卻）：', report.progress.remaining_total);
  console.log('本階段本次尚可處理：', report.progress.eligible_remaining);
  if (!report.dry_run) {
    console.log(
      '已消耗 Track API attempts：',
      report.budget.consumed(),
      '/',
      report.budget.total
    );
  } else {
    console.log(
      '預計新查詢（不含重試）：最多',
      report.plan.planned_track_slots,
      '首'
    );
  }
  console.log('預估批數：', report.plan.planned_batches);
  console.log('每批上限：', report.plan.batch_size);
  console.log('快取完整 ok（跳過）：', report.plan.cache_ok_complete);
  console.log('待補齊佇列：', report.plan.queue_len);
  if (!report.dry_run) {
    console.log('累計 ok：', report.aggregate.run_success_ok);
    console.log('累計 404：', report.aggregate.run_not_found_404);
    console.log('累計 403：', report.aggregate.run_forbidden_403);
    console.log('累計 429：', report.aggregate.run_rate_limited_429);
    console.log('累計 network：', report.aggregate.run_network_error);
    console.log('不可播放：', report.aggregate.run_not_playable);
    console.log('快取總數：', report.cache_stats.cached_entries);
    console.log(
      '剩餘待補齊：',
      report.aggregate.remaining_after_run != null
        ? report.aggregate.remaining_after_run
        : report.plan.queue_len
    );
  }
  console.log('耗時（ms）：', report.duration_ms);
  console.log('安全停止：', report.safe_stopped ? '是' : '否');
  if (report.stop_reason) {
    console.log('停止原因：', report.stop_reason);
  }
  console.log('can_resume：', report.can_resume ? '是' : '否');
  console.log('==============================================\n');
}
