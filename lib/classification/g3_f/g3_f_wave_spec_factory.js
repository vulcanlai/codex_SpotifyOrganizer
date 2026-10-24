/**
 * 由波次編號建立 run_g3_e_wave spec
 */
import { build_g3_f_paths } from './g3_f_paths_dynamic.js';

/**
 * @param {number} wave_number
 * @param {number} [wave_size]
 */
export function build_g3_f_wave_spec(wave_number, wave_size) {
  const p = build_g3_f_paths(wave_number, wave_size || 100);
  return {
    wave_key: p.wave_key,
    wave_dir: p.wave_dir,
    file_wave: p.file_wave,
    file_batch_plan: p.file_batch_plan,
    file_progress: p.file_progress,
    batch_inputs_dir: p.batch_inputs_dir,
    agent_outputs_dir: p.agent_outputs_dir,
    agent_outputs_original_dir: p.agent_outputs_original_dir,
    staged_dir: p.staged_dir,
    file_merged_staged: p.file_merged_staged,
    file_validate: p.file_validate,
    file_qc: p.file_qc,
    file_comparison: null,
    file_provenance: p.file_provenance,
    file_offline_summary: p.file_offline_summary,
    file_expansion: null,
    file_qc_milestones: p.file_qc_milestones,
    file_infer_isolation: p.file_infer_isolation,
    file_validation_corrections: p.file_validation_corrections,
    agent_source: p.agent_source,
    agent_method: p.agent_method,
    batch_input_purpose: p.batch_input_purpose,
    include_review_only_suggestions: false,
    expected_track_count: p.wave_size,
    qc_milestone_every: p.qc_milestone_every,
    qc_gate_first: p.qc_gate_first,
  };
}
