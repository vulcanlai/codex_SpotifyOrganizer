/**
 * G1 外部查證狀態 API（唯讀）
 */
import { get_g1_status_summary } from '../enrichment/external/run_verification.js';
import { load_query_cache } from '../enrichment/external/verification_store.js';
import { build_g1_quality_report } from '../enrichment/external/quality_report.js';

/**
 * @param {string} method
 * @param {string} pathname
 */
export function handle_external_verify_api(method, pathname) {
  if (pathname === '/api/external-verify/status' && method === 'GET') {
    const status = get_g1_status_summary();
    const cache = load_query_cache();
    return {
      status: 200,
      body: {
        external_verify: {
          label: '外部資料查證（G1）',
          sample_id: status.sample_id,
          track_count: status.track_count,
          verified_final_count: status.verified_final_count,
          mode: status.progress.mode,
          network_requests: status.progress.stats.network_requests,
          cache_hits: status.progress.stats.cache_hits,
          cache_query_count: Object.keys(cache.queries || {}).length,
        },
      },
    };
  }
  if (pathname === '/api/external-verify/report-summary' && method === 'GET') {
    const report = build_g1_quality_report({ write: false });
    return {
      status: 200,
      body: { report_summary: report.summary_zh },
    };
  }
  return null;
}
