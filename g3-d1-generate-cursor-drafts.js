/**
 * G3-D.1 由 evidence_payloads 產生 Cursor 草稿（Agent 推理層）
 */
import fs from 'fs';
import path from 'path';
import { classify_g3_d1_from_evidence } from './lib/classification/g3_d/g3_d1_evidence_classify.js';
import {
  FILE_G3_D1_BATCH_PLAN,
  G3_D1_BATCH_INPUTS_DIR,
  G3_D1_CURSOR_DRAFTS_DIR,
} from './lib/classification/g3_d/paths_d1.js';

fs.mkdirSync(G3_D1_CURSOR_DRAFTS_DIR, { recursive: true });
const plan = JSON.parse(fs.readFileSync(FILE_G3_D1_BATCH_PLAN, 'utf8'));
let total = 0;

for (let i = 0; i < plan.batches.length; i += 1) {
  const batch = plan.batches[i];
  const input_path = path.join(
    G3_D1_BATCH_INPUTS_DIR,
    batch.batch_id + '-input.json'
  );
  const input = JSON.parse(fs.readFileSync(input_path, 'utf8'));
  const payloads = input.evidence_payloads || [];
  const by_id = {};
  for (let p = 0; p < payloads.length; p += 1) {
    by_id[payloads[p].track_id] = payloads[p];
  }
  const tracks = [];
  for (let t = 0; t < batch.track_ids.length; t += 1) {
    const tid = batch.track_ids[t];
    const payload = by_id[tid];
    if (!payload) {
      throw new Error('缺少 payload ' + tid);
    }
    tracks.push(classify_g3_d1_from_evidence(payload));
  }
  const doc = {
    schema_version: 1,
    source: 'cursor_agent_g3_d1',
    batch_id: batch.batch_id,
    model_note:
      'G3-D.1 Cursor Agent evidence 推理；含 main_to_allowed_subgenres；未呼叫外部 API',
    main_to_allowed_subgenres: input.main_to_allowed_subgenres,
    tracks: tracks,
  };
  fs.writeFileSync(
    path.join(G3_D1_CURSOR_DRAFTS_DIR, batch.batch_id + '.json'),
    JSON.stringify(doc, null, 2),
    'utf8'
  );
  total += tracks.length;
  console.log(batch.batch_id, tracks.length);
}

console.log('total', total);
