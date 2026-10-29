/**
 * Metadata 自動分批補齊
 * npm run enrich:auto -- --total=2000 [options]
 */
import { get_client_id } from './lib/config.js';
import { run_with_oauth } from './lib/oauth_session.js';
import { parse_enrich_auto_cli } from './lib/enrichment/auto_cli_args.js';
import { EnrichCliError } from './lib/enrichment/cli_args.js';
import {
  run_auto_enrichment,
  print_auto_enrichment_report,
} from './lib/enrichment/run_auto.js';
import { acquire_enrichment_lock, EnrichmentLockError } from './lib/enrichment/process_lock.js';
import {
  assert_cli_may_query_track_api,
  try_backfill_rate_limit_state_from_cache,
  GlobalRateLimitCooldownError,
  GlobalRateLimitStateError,
} from './lib/enrichment/rate_limit_state.js';

const abort_signal = { requested: false };

process.on('SIGINT', function () {
  if (abort_signal.requested) {
    return;
  }
  abort_signal.requested = true;
  console.log('\n[auto] 收到 Ctrl+C，將在目前曲目處理完成後安全停止…');
});

async function main() {
  try {
    get_client_id();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  let cli;
  try {
    cli = parse_enrich_auto_cli(process.argv.slice(2));
  } catch (err) {
    if (err instanceof EnrichCliError) {
      console.error(err.message);
    } else {
      console.error(err && err.message ? err.message : err);
    }
    process.exit(1);
  }

  if (cli.resume) {
    console.log('[auto] --resume：沿用既有快取與 checkpoint。');
  }

  if (!cli.dry_run) {
    try {
      try_backfill_rate_limit_state_from_cache();
      assert_cli_may_query_track_api('enrich:auto', { dry_run: false });
    } catch (err) {
      if (
        err instanceof GlobalRateLimitCooldownError ||
        err instanceof GlobalRateLimitStateError
      ) {
        process.exit(1);
      }
      throw err;
    }
  }

  let lock = null;
  if (!cli.dry_run) {
    try {
      lock = acquire_enrichment_lock({ mode: 'auto', total: cli.total });
    } catch (err) {
      if (err instanceof EnrichmentLockError) {
        console.error(err.message);
        process.exit(1);
      }
      throw err;
    }
  }

  let report;
  try {
    const run_opts = {
      total: cli.total,
      batch_size: cli.batch_size,
      delay_ms: cli.delay_ms,
      batch_pause_sec: cli.batch_pause_sec,
      dry_run: cli.dry_run,
      retry_failed: cli.retry_failed,
      abort_signal,
    };

    if (cli.dry_run) {
      report = await run_auto_enrichment(run_opts);
    } else {
      await run_with_oauth(async function () {
        report = await run_auto_enrichment(run_opts);
      });
    }
  } finally {
    if (lock) {
      lock.release();
    }
  }

  print_auto_enrichment_report(report);

  if (report.safe_stopped && report.aggregate.run_forbidden_403 > 0) {
    process.exitCode = 1;
  }
}

main();
