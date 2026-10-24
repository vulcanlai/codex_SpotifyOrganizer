/**
 * G3-E.2 相容 → 共用 prepare
 */
import { g3_e2_wave_spec } from './g3_e_wave_spec.js';
import { prepare_g3_e_batch_inputs } from './g3_e_prepare_batches.js';

export function prepare_g3_e2_batch_inputs(wave_doc, opts) {
  return prepare_g3_e_batch_inputs(wave_doc, g3_e2_wave_spec(), opts);
}
