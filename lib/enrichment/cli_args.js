/**
 * enrich:tracks CLI 參數
 */
import { ENRICH_MAX_PER_RUN, DEFAULT_DELAY_MS } from './paths.js';

export class EnrichCliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EnrichCliError';
  }
}

/**
 * @param {string[]} argv - process.argv.slice(2)
 */
export function parse_enrich_cli(argv) {
  const args = argv || [];
  let max = null;
  let resume = false;
  let dry_run = false;
  let delay_ms = DEFAULT_DELAY_MS;

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
    if (a.indexOf('--max=') === 0) {
      const raw = a.slice('--max='.length);
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 1) {
        throw new EnrichCliError('--max 必須為正整數');
      }
      max = n;
      continue;
    }
    if (a.indexOf('--delay-ms=') === 0) {
      const raw = a.slice('--delay-ms='.length);
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0) {
        throw new EnrichCliError('--delay-ms 必須為非負整數');
      }
      delay_ms = n;
      continue;
    }
    throw new EnrichCliError(`未知參數：${a}`);
  }

  if (max == null) {
    throw new EnrichCliError(
      '必須提供 --max=N（未提供時不得執行全量）。例：npm run enrich:tracks -- --max=50'
    );
  }
  if (max > ENRICH_MAX_PER_RUN) {
    throw new EnrichCliError(
      `--max=${max} 超過單次上限 ${ENRICH_MAX_PER_RUN}。請分批執行或待使用者同意後再調高限制。`
    );
  }

  return {
    max,
    resume,
    dry_run,
    delay_ms,
  };
}
