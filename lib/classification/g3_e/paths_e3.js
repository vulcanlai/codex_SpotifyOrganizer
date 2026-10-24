/**
 * G3-E.3 剩餘 provenance_unverified wave
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_E3_WAVE_DIR = path.join(CLASSIFICATION_DIR, 'g3-e3-wave-unverified-remainder');

export const FILE_G3_E3_RECONCILE = path.join(G3_E3_WAVE_DIR, 'reconciliation-e1-e2-e3.json');
export const FILE_G3_E3_WAVE = path.join(G3_E3_WAVE_DIR, 'wave-remainder.json');
export const FILE_G3_E3_BATCH_PLAN = path.join(G3_E3_WAVE_DIR, 'batch-plan.json');
export const FILE_G3_E3_PROGRESS = path.join(G3_E3_WAVE_DIR, 'batch-progress.json');
export const G3_E3_BATCH_INPUTS_DIR = path.join(G3_E3_WAVE_DIR, 'batch-inputs');
export const G3_E3_AGENT_OUTPUTS_DIR = path.join(G3_E3_WAVE_DIR, 'agent-outputs');
export const G3_E3_STAGED_DIR = path.join(G3_E3_WAVE_DIR, 'staged-candidates');
export const FILE_G3_E3_MERGED_STAGED = path.join(G3_E3_WAVE_DIR, 'staged-merged.json');
export const FILE_G3_E3_VALIDATE_REPORT = path.join(G3_E3_WAVE_DIR, 'validate-report.json');
export const FILE_G3_E3_QC_REPORT = path.join(G3_E3_WAVE_DIR, 'quality-checkpoints.json');
export const FILE_G3_E3_QC_MILESTONES = path.join(G3_E3_WAVE_DIR, 'quality-milestones.json');
export const FILE_G3_E3_COMPARISON = path.join(G3_E3_WAVE_DIR, 'comparison-d1-d34-e3.json');
export const FILE_G3_E3_PROVENANCE = path.join(G3_E3_WAVE_DIR, 'provenance-report.json');
export const FILE_G3_E3_LEDGER = path.join(G3_E3_WAVE_DIR, 'ledger-e1-e2-e3.json');
export const FILE_G3_E3_PENDING = path.join(G3_E3_WAVE_DIR, 'pending-tracks.json');
export const FILE_G3_E3_OFFLINE_SUMMARY = path.join(G3_E3_WAVE_DIR, 'offline-summary.json');
export const FILE_G3_E3_INFER_ISOLATION = path.join(G3_E3_WAVE_DIR, 'infer-isolation-note.json');

export const G3_E3_WAVE_SEED = 'g3-e3:unverified-remainder:v1';
export const G3_E3_BATCH_SIZE = 10;
export const G3_E3_AGENT_SOURCE = 'cursor_agent_g3_e3';
export const G3_E3_AGENT_METHOD = 'g3_e3_agent_json_infer';
export const G3_E3_QC_MILESTONE_EVERY = 50;
export const G3_E3_QC_GATE_FIRST = 20;
