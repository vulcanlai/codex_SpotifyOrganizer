/**
 * G3-B 30 首試驗樣本（沿用 G1 外部查證 30 首）
 */
import fs from 'node:fs';
import path from 'node:path';
import { G1_TRIAL_DIR } from '../../enrichment/external/g1_path_resolve.js';
import { FILE_G3_B_SAMPLE, G3_B_SAMPLE_ID } from './paths.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function load_g3_b_sample_from_g1() {
  const g1 = read_json(path.join(G1_TRIAL_DIR, 'sample-30.json'));
  if (!g1 || !g1.track_ids || g1.track_ids.length !== 30) {
    throw new Error('缺少 g1-30/sample-30.json 或曲目數非 30');
  }
  return {
    schema_version: 1,
    sample_id: G3_B_SAMPLE_ID,
    source: 'g1-ext-verify-v1',
    purpose: 'g3_b_auto_classify_trial',
    track_count: 30,
    track_ids: g1.track_ids.slice(),
    must_include: g1.must_include ? g1.must_include.slice() : [],
    buckets: g1.buckets || {},
  };
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function ensure_g3_b_sample(opts) {
  const options = opts || {};
  const sample = load_g3_b_sample_from_g1();
  if (options.write !== false) {
    fs.mkdirSync(path.dirname(FILE_G3_B_SAMPLE), { recursive: true });
    fs.writeFileSync(FILE_G3_B_SAMPLE, JSON.stringify(sample, null, 2), 'utf8');
  }
  return sample;
}
