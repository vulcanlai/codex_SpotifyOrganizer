/**
 * G3-E.2 JSON 批次 Agent 分類（20 首 wave）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_E2_WAVE_DIR = path.join(CLASSIFICATION_DIR, 'g3-e2-wave-20');

export const FILE_G3_E2_SAMPLE_20 = path.join(G3_E2_WAVE_DIR, 'wave-sample-20.json');
export const FILE_G3_E2_BATCH_PLAN = path.join(G3_E2_WAVE_DIR, 'batch-plan-4x5.json');
export const FILE_G3_E2_PROGRESS = path.join(G3_E2_WAVE_DIR, 'batch-progress.json');
export const G3_E2_BATCH_INPUTS_DIR = path.join(G3_E2_WAVE_DIR, 'batch-inputs');
export const G3_E2_AGENT_OUTPUTS_DIR = path.join(G3_E2_WAVE_DIR, 'agent-outputs');
export const G3_E2_STAGED_DIR = path.join(G3_E2_WAVE_DIR, 'staged-candidates');
export const FILE_G3_E2_MERGED_STAGED = path.join(G3_E2_WAVE_DIR, 'staged-merged-20.json');
export const FILE_G3_E2_VALIDATE_REPORT = path.join(G3_E2_WAVE_DIR, 'validate-report.json');
export const FILE_G3_E2_QC_REPORT = path.join(G3_E2_WAVE_DIR, 'quality-checkpoints.json');
export const FILE_G3_E2_COMPARISON = path.join(G3_E2_WAVE_DIR, 'comparison-d1-d34-e2-20.json');
export const FILE_G3_E2_PROVENANCE = path.join(G3_E2_WAVE_DIR, 'provenance-report-20.json');
export const FILE_G3_E2_OFFLINE_SUMMARY = path.join(G3_E2_WAVE_DIR, 'offline-summary.json');
export const FILE_G3_E2_EXPANSION_NOTE = path.join(G3_E2_WAVE_DIR, 'expansion-shared-workflow.json');

export const G3_E2_SCHEMA_VERSION = 1;
export const G3_E2_WAVE_SEED = 'g3-e2:wave-20-unverified:v1';
export const G3_E2_BATCH_SIZE = 5;
export const G3_E2_BATCH_COUNT = 4;
export const G3_E2_AGENT_SOURCE = 'cursor_agent_g3_e2';
export const G3_E2_AGENT_METHOD = 'g3_e2_agent_json_infer';

/** E.1 五首不得重複 */
export const G3_E2_EXCLUDE_E1_IDS = [
  '2ENeL62SA94IHbCokT5U2W',
  '0ZOgcAy8cOw7xSWp6IjSfC',
  '680YpUhUvGBLMRQpbuxy1Q',
  '6uIXIZmKdEswGUpHJeNSkk',
  '7rIovIsXE6kMn629b7kDig',
];
