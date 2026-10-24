/**
 * G3-F.5 第五波 100 首 wave
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';
import {
  G3_F1_BATCH_SIZE,
  G3_F1_QC_MILESTONE_EVERY,
  G3_F1_QC_GATE_FIRST,
  G3_F1_PREPARE_LOCK_MAX_AGE_MS,
} from './paths_f1.js';

export const G3_F5_WAVE_DIR = path.join(CLASSIFICATION_DIR, 'g3-f5-wave-100');

export const FILE_G3_F5_PREPARE_LOCK = path.join(G3_F5_WAVE_DIR, 'prepare.lock.json');
export const FILE_G3_F5_PREPARE_TIMING = path.join(G3_F5_WAVE_DIR, 'prepare-phase-timing.json');
export const FILE_G3_F5_FULL_RECONCILE = path.join(G3_F5_WAVE_DIR, 'full-library-reconcile.json');
export const FILE_G3_F5_EXCLUSIVE_STATES = path.join(G3_F5_WAVE_DIR, 'exclusive-primary-states.json');
export const FILE_G3_F5_PENDING_QUEUE = path.join(G3_F5_WAVE_DIR, 'pending-classification-queue.json');
export const FILE_G3_F5_WAVE_100 = path.join(G3_F5_WAVE_DIR, 'wave-sample-100.json');
export const FILE_G3_F5_WAVE_EXCLUSIONS = path.join(G3_F5_WAVE_DIR, 'wave-exclusions.json');
export const FILE_G3_F5_BATCH_PLAN = path.join(G3_F5_WAVE_DIR, 'batch-plan.json');
export const FILE_G3_F5_PROGRESS = path.join(G3_F5_WAVE_DIR, 'batch-progress.json');
export const G3_F5_BATCH_INPUTS_DIR = path.join(G3_F5_WAVE_DIR, 'batch-inputs');
export const G3_F5_AGENT_OUTPUTS_DIR = path.join(G3_F5_WAVE_DIR, 'agent-outputs');
export const G3_F5_AGENT_OUTPUTS_ORIGINAL_DIR = path.join(G3_F5_WAVE_DIR, 'agent-outputs-original');
export const G3_F5_STAGED_DIR = path.join(G3_F5_WAVE_DIR, 'staged-candidates');
export const FILE_G3_F5_MERGED_STAGED = path.join(G3_F5_WAVE_DIR, 'staged-merged.json');
export const FILE_G3_F5_VALIDATE_REPORT = path.join(G3_F5_WAVE_DIR, 'validate-report.json');
export const FILE_G3_F5_VALIDATION_CORRECTIONS = path.join(
  G3_F5_WAVE_DIR,
  'validation-corrections-log.json'
);
export const FILE_G3_F5_QC_REPORT = path.join(G3_F5_WAVE_DIR, 'quality-checkpoints.json');
export const FILE_G3_F5_QC_MILESTONES = path.join(G3_F5_WAVE_DIR, 'quality-milestones.json');
export const FILE_G3_F5_PROVENANCE = path.join(G3_F5_WAVE_DIR, 'provenance-report.json');
export const FILE_G3_F5_OFFLINE_SUMMARY = path.join(G3_F5_WAVE_DIR, 'offline-summary.json');
export const FILE_G3_F5_REMAINING = path.join(G3_F5_WAVE_DIR, 'remaining-after-wave.json');
export const FILE_G3_F5_INFER_ISOLATION = path.join(G3_F5_WAVE_DIR, 'infer-isolation-note.json');

export const G3_F5_WAVE_SEED = 'g3-f5:wave-100:v1';
export const G3_F5_WAVE_SIZE = 100;
export const G3_F5_BATCH_SIZE = G3_F1_BATCH_SIZE;
export const G3_F5_BATCH_ID_PREFIX = 'g3f5-batch-';
export const G3_F5_AGENT_SOURCE = 'cursor_agent_g3_f5';
export const G3_F5_AGENT_METHOD = 'g3_f5_agent_json_infer';
export const G3_F5_QC_MILESTONE_EVERY = G3_F1_QC_MILESTONE_EVERY;
export const G3_F5_QC_GATE_FIRST = G3_F1_QC_GATE_FIRST;
export const G3_F5_PREPARE_LOCK_MAX_AGE_MS = G3_F1_PREPARE_LOCK_MAX_AGE_MS;
