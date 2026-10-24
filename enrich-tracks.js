/**
 * 歌曲 metadata 批次補齊
 * npm run enrich:tracks -- --max=50 [--resume] [--dry-run] [--delay-ms=1000]
 */
import { get_client_id } from './lib/config.js';
import { run_with_oauth } from './lib/oauth_session.js';
import { parse_enrich_cli, EnrichCliError } from './lib/enrichment/cli_args.js';
import {
  run_track_enrichment,
  print_enrichment_report,
} from './lib/enrichment/run_enrich.js';
import {
  assert_cli_may_query_track_api,
  try_backfill_rate_limit_state_from_cache,
  GlobalRateLimitCooldownError,
  GlobalRateLimitStateError,
} from './lib/enrichment/rate_limit_state.js';

async function main() {
  try {
    get_client_id();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  let cli;
  try {
    cli = parse_enrich_cli(process.argv.slice(2));
  } catch (err) {
    if (err instanceof EnrichCliError) {
      console.error(err.message);
    } else {
      console.error(err && err.message ? err.message : err);
    }
    process.exit(1);
  }

  if (cli.resume) {
    console.log('[enrich] --resume：沿用既有快取並從待處理佇列繼續。');
  }

  console.log('Track metadata enrichment（串行、單次上限 50）');

  if (!cli.dry_run) {
    try {
      try_backfill_rate_limit_state_from_cache();
      assert_cli_may_query_track_api('enrich:tracks', { dry_run: false });
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

  let report;
  try {
    if (cli.dry_run) {
      report = await run_track_enrichment({
        max: cli.max,
        dry_run: true,
        delay_ms: cli.delay_ms,
      });
    } else {
      await run_with_oauth(async function () {
        report = await run_track_enrichment({
          max: cli.max,
          dry_run: false,
          delay_ms: cli.delay_ms,
        });
      });
    }
  } catch (err) {
    console.error('\n執行失敗：', err && err.message ? err.message : err);
    process.exit(1);
  }

  print_enrichment_report(report);

  if (report.safe_stopped && report.run_stats.run_forbidden_403 > 0) {
    process.exitCode = 1;
  }
}

main();
