/**
 * enrich:auto CLI 參數
 */
import {
  ENRICH_AUTO_MAX_TOTAL,
  ENRICH_AUTO_DEFAULT_BATCH_SIZE,
  ENRICH_AUTO_DEFAULT_BATCH_PAUSE_SEC,
  ENRICH_MAX_PER_RUN,
  ENRICH_AUTO_MIN_DELAY_MS,
  DEFAULT_DELAY_MS,
} from './paths.js';
import { EnrichCliError } from './cli_args.js';

/**
 * @param {string[]} argv
 */
export function parse_enrich_auto_cli(argv) {
  const args = argv || [];
  let total = null;
  let batch_size = ENRICH_AUTO_DEFAULT_BATCH_SIZE;
  let delay_ms = DEFAULT_DELAY_MS;
  let batch_pause_sec = ENRICH_AUTO_DEFAULT_BATCH_PAUSE_SEC;
  let resume = false;
  let dry_run = false;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--resume') {
      resume = true;
      continue;
    }
    if (a === '--dry-run') {
      dry_run = true;
      continue;
    }
    if (a.indexOf('--total=') === 0) {
      total = parse_int_arg(a, '--total');
      continue;
    }
    if (a.indexOf('--batch-size=') === 0) {
      batch_size = parse_int_arg(a, '--batch-size');
      continue;
    }
    if (a.indexOf('--delay-ms=') === 0) {
      delay_ms = parse_int_arg(a, '--delay-ms');
      continue;
    }
    if (a.indexOf('--batch-pause-sec=') === 0) {
      batch_pause_sec = parse_int_arg(a, '--batch-pause-sec');
      continue;
    }
    throw new EnrichCliError(`未知參數：${a}`);
  }

  if (total == null) {
    throw new EnrichCliError(
      '必須提供 --total=N。例：npm run enrich:auto -- --total=2000'
    );
  }
  if (total > ENRICH_AUTO_MAX_TOTAL) {
    throw new EnrichCliError(
      `--total=${total} 超過上限 ${ENRICH_AUTO_MAX_TOTAL}。`
    );
  }
  if (batch_size > ENRICH_MAX_PER_RUN) {
    throw new EnrichCliError(
      `--batch-size=${batch_size} 超過每批上限 ${ENRICH_MAX_PER_RUN}。`
    );
  }
  if (delay_ms < ENRICH_AUTO_MIN_DELAY_MS) {
    throw new EnrichCliError(
      `--delay-ms 不得低於 ${ENRICH_AUTO_MIN_DELAY_MS}ms。`
    );
  }

  return {
    total,
    batch_size,
    delay_ms,
    batch_pause_sec,
    resume,
    dry_run,
  };
}

/**
 * @param {string} arg
 * @param {string} label
 */
function parse_int_arg(arg, label) {
  const raw = arg.slice(label.length + 1);
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new EnrichCliError(`${label} 必須為正整數`);
  }
  return n;
}
