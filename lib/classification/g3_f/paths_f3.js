/**
 * G3-F.3 第三波 100 首 wave
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';
import {
  G3_F1_BATCH_SIZE,
  G3_F1_QC_MILESTONE_EVERY,
  G3_F1_QC_GATE_FIRST,
  G3_F1_PREPARE_LOCK_MAX_AGE_MS,
} from './paths_f1.js';

export const G3_F3_WAVE_DIR = path.join(CLASSIFICATION_DIR, 'g3-f3-wave-100');

export const FILE_G3_F3_PREPARE_LOCK = path.join(G3_F3_WAVE_DIR, 'prepare.lock.json');
export const FILE_G3_F3_PREPARE_TIMING = path.join(G3_F3_WAVE_DIR, 'prepare-phase-timing.json');
export const FILE_G3_F3_FULL_RECONCILE = path.join(G3_F3_WAVE_DIR, 'full-library-reconcile.json');
export const FILE_G3_F3_EXCLUSIVE_STATES = path.join(G3_F3_WAVE_DIR, 'exclusive-primary-states.json');
export const FILE_G3_F3_PENDING_QUEUE = path.join(G3_F3_WAVE_DIR, 'pending-classification-queue.json');
export const FILE_G3_F3_WAVE_100 = path.join(G3_F3_WAVE_DIR, 'wave-sample-100.json');
export const FILE_G3_F3_WAVE_EXCLUSIONS = path.join(G3_F3_WAVE_DIR, 'wave-exclusions.json');
export const FILE_G3_F3_BATCH_PLAN = path.join(G3_F3_WAVE_DIR, 'batch-plan.json');
export const FILE_G3_F3_PROGRESS = path.join(G3_F3_WAVE_DIR, 'batch-progress.json');
export const G3_F3_BATCH_INPUTS_DIR = path.join(G3_F3_WAVE_DIR, 'batch-inputs');
export const G3_F3_AGENT_OUTPUTS_DIR = path.join(G3_F3_WAVE_DIR, 'agent-outputs');
export const G3_F3_AGENT_OUTPUTS_ORIGINAL_DIR = path.join(G3_F3_WAVE_DIR, 'agent-outputs-original');
export const G3_F3_STAGED_DIR = path.join(G3_F3_WAVE_DIR, 'staged-candidates');
export const FILE_G3_F3_MERGED_STAGED = path.join(G3_F3_WAVE_DIR, 'staged-merged.json');
export const FILE_G3_F3_VALIDATE_REPORT = path.join(G3_F3_WAVE_DIR, 'validate-report.json');
export const FILE_G3_F3_VALIDATION_CORRECTIONS = path.join(
  G3_F3_WAVE_DIR,
  'validation-corrections-log.json'
);
export const FILE_G3_F3_QC_REPORT = path.join(G3_F3_WAVE_DIR, 'quality-checkpoints.json');
export const FILE_G3_F3_QC_MILESTONES = path.join(G3_F3_WAVE_DIR, 'quality-milestones.json');
export const FILE_G3_F3_PROVENANCE = path.join(G3_F3_WAVE_DIR, 'provenance-report.json');
export const FILE_G3_F3_OFFLINE_SUMMARY = path.join(G3_F3_WAVE_DIR, 'offline-summary.json');
export const FILE_G3_F3_REMAINING = path.join(G3_F3_WAVE_DIR, 'remaining-after-wave.json');
export const FILE_G3_F3_INFER_ISOLATION = path.join(G3_F3_WAVE_DIR, 'infer-isolation-note.json');

export const G3_F3_WAVE_SEED = 'g3-f3:wave-100:v1';
export const G3_F3_WAVE_SIZE = 100;
export const G3_F3_BATCH_SIZE = G3_F1_BATCH_SIZE;
export const G3_F3_BATCH_ID_PREFIX = 'g3f3-batch-';
export const G3_F3_AGENT_SOURCE = 'cursor_agent_g3_f3';
export const G3_F3_AGENT_METHOD = 'g3_f3_agent_json_infer';
export const G3_F3_QC_MILESTONE_EVERY = G3_F1_QC_MILESTONE_EVERY;
export const G3_F3_QC_GATE_FIRST = G3_F1_QC_GATE_FIRST;
export const G3_F3_PREPARE_LOCK_MAX_AGE_MS = G3_F1_PREPARE_LOCK_MAX_AGE_MS;
