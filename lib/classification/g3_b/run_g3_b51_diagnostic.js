/**
 * G3-B.5.1 離線診斷寫入
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { run_title_coverage_diagnostic } from './title_coverage_diagnostic.js';
import {
  G3_B51_DIAG_DIR,
  FILE_B51_TITLE_COVERAGE,
  FILE_B51_EXCLUSION_COUNTS,
  FILE_B51_EXCLUSION_INDEX,
  FILE_B51_OFFLINE_BACKFILL,
  FILE_B51_NEEDS_SPOTIFY_API,
  FILE_B51_POOL_FIX_SUGGESTIONS,
  FILE_B51_SAMPLE_100_IMPACT,
  FILE_B51_OFFLINE_SUMMARY,
  B51_SCHEMA_VERSION,
} from './paths_b51.js';

/**
 * @param {{ write?: boolean }} [opts]
 */
export function run_g3_b51_diagnostic(opts) {
  const options = opts || {};
  const write = options.write !== false;

  if (write && !fs.existsSync(G3_B51_DIAG_DIR)) {
    fs.mkdirSync(G3_B51_DIAG_DIR, { recursive: true });
  }

  let index_stream = null;
  if (write) {
    index_stream = fs.createWriteStream(FILE_B51_EXCLUSION_INDEX, { encoding: 'utf8' });
  }

  const result = run_title_coverage_diagnostic({
    index_stream: index_stream,
  });

  if (index_stream) {
    index_stream.end();
  }

  const generated_at = new Date().toISOString();
  const summary = {
    schema_version: B51_SCHEMA_VERSION,
    generated_at: generated_at,
    coverage: result.coverage_summary,
    exclusion_counts: result.exclusion_reason_counts.counts,
    offline_backfill_count: result.offline_backfill.candidate_count,
    needs_spotify_api_count: result.needs_api.track_count,
    g3b5_pool_size: result.coverage_summary.g3b5_sampling_pool_size,
    keep_sample_100: result.sample_impact.keep_sample_100_recommendation,
    summary_zh: [
      '全庫 7759；至少一來源有 title ' +
        result.coverage_summary.at_least_one_source_has_title +
        '；全無 title ' +
        result.coverage_summary.all_sources_no_valid_title,
      '抽樣池 ' + result.coverage_summary.g3b5_sampling_pool_size + '（非 5894 皆無 title）',
      '可離線補齊 ' + result.offline_backfill.candidate_count + '；需 Spotify API ' + result.needs_api.track_count,
    ],
  };

  if (write) {
    write_json_atomic(FILE_B51_TITLE_COVERAGE, Object.assign({}, result.coverage_summary, {
      generated_at: generated_at,
    }));
    write_json_atomic(FILE_B51_EXCLUSION_COUNTS, Object.assign({}, result.exclusion_reason_counts, {
      generated_at: generated_at,
    }));
    write_json_atomic(FILE_B51_OFFLINE_BACKFILL, Object.assign({}, result.offline_backfill, {
      generated_at: generated_at,
    }));
    write_json_atomic(FILE_B51_NEEDS_SPOTIFY_API, Object.assign({}, result.needs_api, {
      generated_at: generated_at,
    }));
    write_json_atomic(FILE_B51_POOL_FIX_SUGGESTIONS, Object.assign({}, result.pool_fix, {
      generated_at: generated_at,
    }));
    write_json_atomic(FILE_B51_SAMPLE_100_IMPACT, Object.assign({}, result.sample_impact, {
      generated_at: generated_at,
    }));
    write_json_atomic(FILE_B51_OFFLINE_SUMMARY, summary);
  }

  return {
    summary: summary,
    result: result,
  };
}
