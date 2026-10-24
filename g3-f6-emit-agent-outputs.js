#!/usr/bin/env node
/**
 * 合併 agent-decisions-batch-*.json → agent-outputs/*-output.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { G3_F6_WAVE_DIR } from './lib/classification/g3_f/paths_f6.js';
import { emit_g3_f6_agent_outputs } from './lib/classification/g3_f/g3_f6_emit_agent_outputs.js';

/** @type {Record<string, object>} */
const merged = {};
for (let i = 1; i <= 10; i += 1) {
  const num = String(i).padStart(2, '0');
  const p = path.join(G3_F6_WAVE_DIR, 'agent-decisions-batch-' + num + '.json');
  if (!fs.existsSync(p)) {
    console.error('缺少：' + p);
    process.exit(1);
  }
  const batch = JSON.parse(fs.readFileSync(p, 'utf8'));
  const keys = Object.keys(batch);
  for (let k = 0; k < keys.length; k += 1) {
    merged[keys[k]] = batch[keys[k]];
  }
}
const r = emit_g3_f6_agent_outputs(merged, { write: true });
console.log(JSON.stringify({ merged_track_decisions: Object.keys(merged).length, batches: r.batches }, null, 2));
