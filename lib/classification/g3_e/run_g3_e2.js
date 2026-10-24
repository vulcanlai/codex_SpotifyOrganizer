/**
 * G3-E.2 prepare → ingest Agent JSON → validate → audit → stage
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { select_g3_e2_wave_20 } from './g3_e2_sample_20.js';
import { g3_e2_wave_spec } from './g3_e_wave_spec.js';
import { run_g3_e_wave } from './run_g3_e_wave.js';
import { G3_E1_DIR } from './paths_e1.js';
import { G3_E2_WAVE_DIR, FILE_G3_E2_EXPANSION_NOTE } from './paths_e2.js';

/**
 * @param {{ write?: boolean, stop_on_qc_fail?: boolean }} [opts]
 */
export function run_g3_e2(opts) {
  const options = opts || {};
  const write = options.write !== false;
  const spec = g3_e2_wave_spec();
  const wave = select_g3_e2_wave_20();
  const r = run_g3_e_wave(spec, wave, {
    write: write,
    stop_on_qc_fail: options.stop_on_qc_fail !== false,
  });

  if (write) {
    const expansion = {
      schema_version: 1,
      shared_dirs: {
        wave_root: 'backup/classification/g3-e2-wave-*',
        batch_inputs: 'batch-inputs/*-input.json',
        agent_outputs: 'agent-outputs/*-output.json',
        staged: 'staged-candidates/*-staged.json',
        progress: 'batch-progress.json',
      },
      next_queues_zh: ['G3-E.3 剩餘 unverified', '其他 D.1 修復列', '全庫約 1,476 首未分類'],
      e1_pilot_preserved: G3_E1_DIR,
    };
    fs.mkdirSync(G3_E2_WAVE_DIR, { recursive: true });
    write_json_atomic(FILE_G3_E2_EXPANSION_NOTE, expansion);
  }

  const summary = Object.assign({}, r.summary, {
    wave_track_count: 20,
  });
  return { summary: summary, wave: r.wave, progress: r.progress, comparison: r.comparison };
}
