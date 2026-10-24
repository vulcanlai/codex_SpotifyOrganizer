/**
 * G3-E.1 可追溯 Agent 分類試驗（5 首）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_E1_DIR = path.join(CLASSIFICATION_DIR, 'g3-e1-pilot-5');

export const FILE_G3_E1_FLOW_ANALYSIS = path.join(G3_E1_DIR, 'pipeline-flow-analysis.json');
export const FILE_G3_E1_SAMPLE_5 = path.join(G3_E1_DIR, 'pilot-sample-5.json');
export const FILE_G3_E1_INPUT_MANIFEST = path.join(G3_E1_DIR, 'input-manifest.json');
export const G3_E1_INPUTS_DIR = path.join(G3_E1_DIR, 'inputs');
export const G3_E1_STAGED_DIR = path.join(G3_E1_DIR, 'staged-inferences');
export const FILE_G3_E1_INFER_MANIFEST = path.join(G3_E1_DIR, 'run-manifest-infer.json');
export const FILE_G3_E1_VALIDATE_REPORT = path.join(G3_E1_DIR, 'validate-report.json');
export const FILE_G3_E1_AUDIT_REPORT = path.join(G3_E1_DIR, 'audit-provenance-report.json');
export const FILE_G3_E1_COMPARISON = path.join(G3_E1_DIR, 'comparison-d1-d34-e1-5.json');
export const FILE_G3_E1_CONTINUATION_PLAN = path.join(G3_E1_DIR, 'continuation-plan-140-1476.json');
export const FILE_G3_E1_OFFLINE_SUMMARY = path.join(G3_E1_DIR, 'offline-summary.json');

export const G3_E1_SCHEMA_VERSION = 1;
export const G3_E1_PILOT_SEED = 'g3-e1:pilot-5:v1';
export const G3_E1_RUN_ID = 'g3-e1-pilot-run-2026-10-22';
export const G3_E1_AGENT_SOURCE = 'cursor_agent_g3_e1';
export const G3_E1_AGENT_METHOD = 'g3_e1_cursor_agent_infer';
export const G3_E1_PROVENANCE_DECLARED = 'agent_workflow_declared';
