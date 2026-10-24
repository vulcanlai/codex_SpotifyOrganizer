/**
 * G3-F 動態 wave 路徑（F.7+ 通用工具；F.1～F.6 靜態 paths_fN 不變）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';
import {
  G3_F1_BATCH_SIZE,
  G3_F1_QC_MILESTONE_EVERY,
  G3_F1_QC_GATE_FIRST,
  G3_F1_PREPARE_LOCK_MAX_AGE_MS,
} from './paths_f1.js';

/**
 * @param {number} wave_number 1-based F 波次編號
 * @param {number} [wave_size]
 */
export function g3_f_wave_dir_name(wave_number, wave_size) {
  const size = wave_size || 100;
  return 'g3-f' + wave_number + '-wave-' + size;
}

/**
 * @param {number} wave_number
 * @param {number} [wave_size]
 */
export function build_g3_f_paths(wave_number, wave_size) {
  const size = wave_size || 100;
  const wave_dir = path.join(CLASSIFICATION_DIR, g3_f_wave_dir_name(wave_number, size));
  const batch_prefix = 'g3f' + wave_number + '-batch-';
  const wave_key = 'f' + wave_number;
  return {
    wave_number: wave_number,
    wave_size: size,
    wave_key: wave_key,
    wave_dir: wave_dir,
    wave_id: g3_f_wave_dir_name(wave_number, size),
    file_prepare_lock: path.join(wave_dir, 'prepare.lock.json'),
    file_prepare_timing: path.join(wave_dir, 'prepare-phase-timing.json'),
    file_full_reconcile: path.join(wave_dir, 'full-library-reconcile.json'),
    file_exclusive_states: path.join(wave_dir, 'exclusive-primary-states.json'),
    file_pending_queue: path.join(wave_dir, 'pending-classification-queue.json'),
    file_wave: path.join(wave_dir, 'wave-sample-' + size + '.json'),
    file_wave_manifest: path.join(wave_dir, 'wave-manifest.json'),
    file_wave_exclusions: path.join(wave_dir, 'wave-exclusions.json'),
    file_batch_plan: path.join(wave_dir, 'batch-plan.json'),
    file_progress: path.join(wave_dir, 'batch-progress.json'),
    batch_inputs_dir: path.join(wave_dir, 'batch-inputs'),
    agent_outputs_dir: path.join(wave_dir, 'agent-outputs'),
    agent_outputs_original_dir: path.join(wave_dir, 'agent-outputs-original'),
    staged_dir: path.join(wave_dir, 'staged-candidates'),
    file_merged_staged: path.join(wave_dir, 'staged-merged.json'),
    file_validate: path.join(wave_dir, 'validate-report.json'),
    file_validation_corrections: path.join(wave_dir, 'validation-corrections-log.json'),
    file_qc: path.join(wave_dir, 'quality-checkpoints.json'),
    file_qc_milestones: path.join(wave_dir, 'quality-milestones.json'),
    file_provenance: path.join(wave_dir, 'provenance-report.json'),
    file_offline_summary: path.join(wave_dir, 'offline-summary.json'),
    file_remaining: path.join(wave_dir, 'remaining-after-wave.json'),
    file_infer_isolation: path.join(wave_dir, 'infer-isolation-note.json'),
    wave_seed: 'g3-f' + wave_number + ':wave-' + size + ':v1',
    batch_id_prefix: batch_prefix,
    batch_size: G3_F1_BATCH_SIZE,
    agent_source: 'cursor_agent_g3_f' + wave_number,
    agent_method: 'g3_f' + wave_number + '_agent_json_infer',
    batch_input_purpose: 'g3_f' + wave_number + '_agent_infer_batch_input',
    qc_milestone_every: G3_F1_QC_MILESTONE_EVERY,
    qc_gate_first: G3_F1_QC_GATE_FIRST,
    prepare_lock_max_age_ms: G3_F1_PREPARE_LOCK_MAX_AGE_MS,
  };
}
