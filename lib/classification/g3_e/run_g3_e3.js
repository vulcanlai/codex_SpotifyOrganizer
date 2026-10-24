/**
 * G3-E.3 剩餘 provenance_unverified wave
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import {
  build_g3_e3_reconciliation,
  select_g3_e3_wave,
} from './g3_e3_reconcile.js';
import { g3_e3_wave_spec } from './g3_e_wave_spec.js';
import { run_g3_e_wave } from './run_g3_e_wave.js';
import { prepare_g3_e_batch_inputs } from './g3_e_prepare_batches.js';
import { FILE_G3_E3_RECONCILE } from './paths_e3.js';

/**
 * @param {{ write?: boolean, stop_on_qc_fail?: boolean }} [opts]
 */
export function run_g3_e3(opts) {
  const options = opts || {};
  const write = options.write !== false;
  const spec = g3_e3_wave_spec();
  const recon = build_g3_e3_reconciliation();
  const wave = select_g3_e3_wave();

  if (write) {
    fs.mkdirSync(spec.wave_dir, { recursive: true });
    write_json_atomic(FILE_G3_E3_RECONCILE, recon);
  }

  const r = run_g3_e_wave(spec, wave, {
    write: write,
    stop_on_qc_fail: options.stop_on_qc_fail !== false,
  });

  return {
    summary: r.summary,
    wave: r.wave,
    progress: r.progress,
    comparison: r.comparison,
    reconciliation: recon,
  };
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function prepare_g3_e3(opts) {
  const options = opts || {};
  const write = options.write !== false;
  const recon = build_g3_e3_reconciliation();
  const wave = select_g3_e3_wave();
  const spec = g3_e3_wave_spec();
  if (write) {
    fs.mkdirSync(spec.wave_dir, { recursive: true });
    write_json_atomic(FILE_G3_E3_RECONCILE, recon);
    write_json_atomic(spec.file_wave, wave);
    write_json_atomic(spec.file_batch_plan, { batches: wave.batches });
  }
  prepare_g3_e_batch_inputs(wave, spec, { write: write });
  return { reconciliation: recon, wave: wave };
}
