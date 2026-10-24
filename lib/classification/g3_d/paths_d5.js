/**
 * G3-D.5 採用前品質驗收
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_D5_DIR = path.join(CLASSIFICATION_DIR, 'g3-d5-pre-adopt');

export const FILE_G3_D5_PROVENANCE = path.join(G3_D5_DIR, 'agent-provenance-audit-200.json');
export const FILE_G3_D5_SPOT_40 = path.join(G3_D5_DIR, 'spot-check-40.json');
export const FILE_G3_D5_NEEDS_EVIDENCE = path.join(G3_D5_DIR, 'needs-evidence-breakdown.json');
export const FILE_G3_D5_ELIGIBILITY = path.join(G3_D5_DIR, 'eligibility-abcd-200.json');
export const FILE_G3_D5_ADOPT_DRY_RUN = path.join(G3_D5_DIR, 'adopt-dry-run-simulation.json');
export const FILE_G3_D5_RISKS = path.join(G3_D5_DIR, 'unresolved-risks.json');
export const FILE_G3_D5_RECOMMENDATION = path.join(G3_D5_DIR, 'enable-adopt-recommendation.json');
export const FILE_G3_D5_OFFLINE_SUMMARY = path.join(G3_D5_DIR, 'offline-summary.json');
export const FILE_G3_D5_ELIGIBILITY_POLICY = path.join(G3_D5_DIR, 'adopt-eligibility-policy.json');

export const G3_D5_SCHEMA_VERSION = 1;
export const G3_D5_SPOT_SEED = 'g3-d5:spot-check-40:v1';
export const G3_D5_SPOT_SIZE = 40;

/** D.4 04–17 由 builder 腳本產出，非 session log */
export const G3_D5_BUILDER_SCRIPT_REL =
  'backup/classification/g3-d4-wave-170/cursor-agent-drafts/build_batches_04_17.mjs';
