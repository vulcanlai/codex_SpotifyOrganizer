/**
 * G3-F.4 wave spec（run_g3_e_wave）
 */
import {
  G3_F4_WAVE_DIR,
  FILE_G3_F4_WAVE_100,
  FILE_G3_F4_BATCH_PLAN,
  FILE_G3_F4_PROGRESS,
  G3_F4_BATCH_INPUTS_DIR,
  G3_F4_AGENT_OUTPUTS_DIR,
  G3_F4_AGENT_OUTPUTS_ORIGINAL_DIR,
  G3_F4_STAGED_DIR,
  FILE_G3_F4_MERGED_STAGED,
  FILE_G3_F4_VALIDATE_REPORT,
  FILE_G3_F4_QC_REPORT,
  FILE_G3_F4_PROVENANCE,
  FILE_G3_F4_OFFLINE_SUMMARY,
  FILE_G3_F4_QC_MILESTONES,
  FILE_G3_F4_INFER_ISOLATION,
  FILE_G3_F4_VALIDATION_CORRECTIONS,
  G3_F4_AGENT_SOURCE,
  G3_F4_AGENT_METHOD,
  G3_F4_QC_MILESTONE_EVERY,
  G3_F4_QC_GATE_FIRST,
} from './paths_f4.js';

/** @returns {import('../g3_e/g3_e_wave_spec.js').G3EWaveSpec & {
 *   agent_outputs_original_dir: string,
 *   file_qc_milestones: string,
 *   file_infer_isolation: string,
 *   file_validation_corrections: string,
 * }} */
export function g3_f4_wave_spec() {
  return {
    wave_key: 'f4',
    wave_dir: G3_F4_WAVE_DIR,
    file_wave: FILE_G3_F4_WAVE_100,
    file_batch_plan: FILE_G3_F4_BATCH_PLAN,
    file_progress: FILE_G3_F4_PROGRESS,
    batch_inputs_dir: G3_F4_BATCH_INPUTS_DIR,
    agent_outputs_dir: G3_F4_AGENT_OUTPUTS_DIR,
    agent_outputs_original_dir: G3_F4_AGENT_OUTPUTS_ORIGINAL_DIR,
    staged_dir: G3_F4_STAGED_DIR,
    file_merged_staged: FILE_G3_F4_MERGED_STAGED,
    file_validate: FILE_G3_F4_VALIDATE_REPORT,
    file_qc: FILE_G3_F4_QC_REPORT,
    file_comparison: null,
    file_provenance: FILE_G3_F4_PROVENANCE,
    file_offline_summary: FILE_G3_F4_OFFLINE_SUMMARY,
    file_expansion: null,
    file_qc_milestones: FILE_G3_F4_QC_MILESTONES,
    file_infer_isolation: FILE_G3_F4_INFER_ISOLATION,
    file_validation_corrections: FILE_G3_F4_VALIDATION_CORRECTIONS,
    agent_source: G3_F4_AGENT_SOURCE,
    agent_method: G3_F4_AGENT_METHOD,
    batch_input_purpose: 'g3_f4_agent_infer_batch_input',
    include_review_only_suggestions: false,
    expected_track_count: 100,
    qc_milestone_every: G3_F4_QC_MILESTONE_EVERY,
    qc_gate_first: G3_F4_QC_GATE_FIRST,
  };
}
