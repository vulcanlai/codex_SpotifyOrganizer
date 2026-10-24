#!/usr/bin/env node
/**
 * 僅 prepare 批次輸入（不含 infer）
 */
import fs from 'fs';
import { write_json_atomic } from './lib/atomic_json.js';
import { select_g3_e2_wave_20 } from './lib/classification/g3_e/g3_e2_sample_20.js';
import { prepare_g3_e2_batch_inputs } from './lib/classification/g3_e/g3_e2_prepare_batches.js';
import {
  G3_E2_WAVE_DIR,
  FILE_G3_E2_SAMPLE_20,
  FILE_G3_E2_BATCH_PLAN,
} from './lib/classification/g3_e/paths_e2.js';

const wave = select_g3_e2_wave_20();
fs.mkdirSync(G3_E2_WAVE_DIR, { recursive: true });
write_json_atomic(FILE_G3_E2_SAMPLE_20, wave);
write_json_atomic(FILE_G3_E2_BATCH_PLAN, { batches: wave.batches });
prepare_g3_e2_batch_inputs(wave, { write: true });
console.log(
  JSON.stringify(
    {
      prepared: true,
      track_count: wave.track_count,
      batches: wave.batches.map(function (b) {
        return b.batch_id;
      }),
      note_zh: '下一步：Cursor Agent 填寫 agent-outputs/*-output.json 後執行 g3:e2-run',
    },
    null,
    2
  )
);
