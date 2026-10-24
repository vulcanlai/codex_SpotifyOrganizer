/**
 * G3-F.1 wave spec（run_g3_e_wave）
 */
import {
  G3_F1_WAVE_DIR,
  FILE_G3_F1_WAVE_100,
  FILE_G3_F1_BATCH_PLAN,
  FILE_G3_F1_PROGRESS,
  G3_F1_BATCH_INPUTS_DIR,
  G3_F1_AGENT_OUTPUTS_DIR,
  G3_F1_STAGED_DIR,
  FILE_G3_F1_MERGED_STAGED,
  FILE_G3_F1_VALIDATE_REPORT,
  FILE_G3_F1_QC_REPORT,
  FILE_G3_F1_PROVENANCE,
  FILE_G3_F1_OFFLINE_SUMMARY,
  FILE_G3_F1_QC_MILESTONES,
  FILE_G3_F1_INFER_ISOLATION,
  G3_F1_AGENT_SOURCE,
  G3_F1_AGENT_METHOD,
  G3_F1_QC_MILESTONE_EVERY,
  G3_F1_QC_GATE_FIRST,
} from './paths_f1.js';

/** @returns {import('../g3_e/g3_e_wave_spec.js').G3EWaveSpec} */
export function g3_f1_wave_spec() {
  return {
    wave_key: 'f1',
    wave_dir: G3_F1_WAVE_DIR,
    file_wave: FILE_G3_F1_WAVE_100,
    file_batch_plan: FILE_G3_F1_BATCH_PLAN,
    file_progress: FILE_G3_F1_PROGRESS,
    batch_inputs_dir: G3_F1_BATCH_INPUTS_DIR,
    agent_outputs_dir: G3_F1_AGENT_OUTPUTS_DIR,
    staged_dir: G3_F1_STAGED_DIR,
    file_merged_staged: FILE_G3_F1_MERGED_STAGED,
    file_validate: FILE_G3_F1_VALIDATE_REPORT,
    file_qc: FILE_G3_F1_QC_REPORT,
    file_comparison: null,
    file_provenance: FILE_G3_F1_PROVENANCE,
    file_offline_summary: FILE_G3_F1_OFFLINE_SUMMARY,
    file_expansion: null,
    file_qc_milestones: FILE_G3_F1_QC_MILESTONES,
    file_infer_isolation: FILE_G3_F1_INFER_ISOLATION,
    agent_source: G3_F1_AGENT_SOURCE,
    agent_method: G3_F1_AGENT_METHOD,
    batch_input_purpose: 'g3_f1_agent_infer_batch_input',
    include_review_only_suggestions: false,
    expected_track_count: 100,
    qc_milestone_every: G3_F1_QC_MILESTONE_EVERY,
    qc_gate_first: G3_F1_QC_GATE_FIRST,
  };
}
