/**
 * G3-D.3 修復試驗（不覆寫 D.1 匯入）
 */
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';

export const G3_D3_REPAIR_DIR = path.join(CLASSIFICATION_DIR, 'g3-d3-repair-30');

export const FILE_G3_D3_LINEAGE_200 = path.join(G3_D3_REPAIR_DIR, 'd1-lineage-200.json');
export const FILE_G3_D3_CATALOG_SOURCE_OVERLAY = path.join(
  G3_D3_REPAIR_DIR,
  'catalog-inference-source-overlay-200.json'
);
export const FILE_G3_D3_SAMPLE_30 = path.join(G3_D3_REPAIR_DIR, 'repair-sample-30.json');
export const FILE_G3_D3_AGENT_DRAFTS_30 = path.join(G3_D3_REPAIR_DIR, 'cursor-agent-drafts-30.json');
export const FILE_G3_D3_COMPARISON = path.join(G3_D3_REPAIR_DIR, 'comparison-d1-d2-d3.json');
export const FILE_G3_D3_PREVIEW_SIMULATION = path.join(
  G3_D3_REPAIR_DIR,
  'preview-adoption-simulation.json'
);
export const FILE_G3_D3_OFFLINE_SUMMARY = path.join(G3_D3_REPAIR_DIR, 'offline-summary.json');
export const FILE_G3_D3_INPUT_30 = path.join(G3_D3_REPAIR_DIR, 'evidence-payloads-30.json');

export const G3_D3_SCHEMA_VERSION = 1;
export const G3_D3_SAMPLE_SEED = 'g3-d3:repair-sample-30:v1';
