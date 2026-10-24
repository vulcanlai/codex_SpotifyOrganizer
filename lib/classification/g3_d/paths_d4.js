/**
 * G3-D.4 170 首 Cursor Agent 推理（不覆寫 D.1／D.3）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_D4_WAVE_DIR = path.join(CLASSIFICATION_DIR, 'g3-d4-wave-170');

export const FILE_G3_D4_RECONCILE = path.join(G3_D4_WAVE_DIR, 'reconcile-200.json');
export const FILE_G3_D4_PENDING_170 = path.join(G3_D4_WAVE_DIR, 'pending-170.json');
export const FILE_G3_D4_BATCH_PLAN = path.join(G3_D4_WAVE_DIR, 'batch-plan-17x10.json');
export const FILE_G3_D4_PROGRESS = path.join(G3_D4_WAVE_DIR, 'batch-progress.json');
export const G3_D4_BATCH_INPUTS_DIR = path.join(G3_D4_WAVE_DIR, 'batch-inputs');
export const G3_D4_AGENT_DRAFTS_DIR = path.join(G3_D4_WAVE_DIR, 'cursor-agent-drafts');
export const FILE_G3_D4_MERGED_AGENT_170 = path.join(G3_D4_WAVE_DIR, 'cursor-agent-merged-170.json');
export const FILE_G3_D4_MERGED_CANDIDATE_200 = path.join(G3_D4_WAVE_DIR, 'merged-candidate-200.json');
export const FILE_G3_D4_COMPARISON_200 = path.join(G3_D4_WAVE_DIR, 'comparison-d1-d2-d34-200.json');
export const FILE_G3_D4_QUALITY_REPORT = path.join(G3_D4_WAVE_DIR, 'quality-checkpoints.json');
export const FILE_G3_D4_ADOPT_SCHEME = path.join(G3_D4_WAVE_DIR, 'adopt-overlay-scheme.json');
export const FILE_G3_D4_ADOPT_SIMULATION = path.join(G3_D4_WAVE_DIR, 'adopt-overlay-simulation.json');
export const FILE_G3_D4_OFFLINE_SUMMARY = path.join(G3_D4_WAVE_DIR, 'offline-summary.json');
export const FILE_G3_D4_INFERENCE_OVERLAY = path.join(G3_D4_WAVE_DIR, 'catalog-inference-source-overlay-d1-200-v2.json');

export const G3_D4_SCHEMA_VERSION = 1;
export const G3_D4_PENDING_SEED = 'g3-d4:pending-170:v1';
export const G3_D4_BATCH_SIZE = 10;
export const G3_D4_BATCH_COUNT = 17;
export const G3_D4_AGENT_SOURCE = 'cursor_agent_g3_d4';
export const G3_D4_AGENT_METHOD = 'g3_d4_cursor_agent';

/** 採用 overlay 方案檔（本階段 enabled 必須 false） */
export const FILE_G3_D4_ADOPT_OVERLAY = path.join(G3_D4_WAVE_DIR, 'adopt-overlay-draft.json');
