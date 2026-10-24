/**
 * 外部查證執行期目錄（G1 / G2 隔離）
 */
import path from 'node:path';
import { G1_TRIAL_DIR } from './g1_path_resolve.js';

export { G1_TRIAL_DIR };

export const G2_TRIAL_DIR = path.join(
  path.dirname(G1_TRIAL_DIR),
  'g2-30'
);

const ENV_G1 = 'SPOTIFYORG_G1_DATA_DIR';
const ENV_G2 = 'SPOTIFYORG_G2_DATA_DIR';

/** @type {'g1'|'g2'} */
let runtime_engine = 'g1';

/**
 * @param {'g1'|'g2'} engine
 */
export function set_verify_engine(engine) {
  runtime_engine = engine === 'g2' ? 'g2' : 'g1';
}

export function get_verify_engine() {
  return runtime_engine;
}

export function verify_data_dir() {
  if (runtime_engine === 'g2') {
    const g2 = process.env[ENV_G2];
    if (g2 && String(g2).trim()) {
      return path.resolve(String(g2).trim());
    }
    return G2_TRIAL_DIR;
  }
  const g1 = process.env[ENV_G1];
  if (g1 && String(g1).trim()) {
    return path.resolve(String(g1).trim());
  }
  return G1_TRIAL_DIR;
}

export function file_verify_query_cache() {
  return path.join(verify_data_dir(), 'query-cache.json');
}

export function file_verify_verification() {
  return path.join(verify_data_dir(), 'verification-results.json');
}

export function file_verify_progress() {
  return path.join(verify_data_dir(), 'progress.json');
}

export function file_verify_quality_report() {
  return path.join(verify_data_dir(), 'quality-report.json');
}

export function file_g2_compare_report() {
  return path.join(G2_TRIAL_DIR, 'g1-vs-g2-compare.json');
}
