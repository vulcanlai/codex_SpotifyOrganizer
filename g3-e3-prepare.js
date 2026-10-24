#!/usr/bin/env node
import { prepare_g3_e3 } from './lib/classification/g3_e/run_g3_e3.js';

const r = prepare_g3_e3({ write: true });
console.log(
  JSON.stringify(
    {
      prepared: true,
      remainder_count: r.reconciliation.remainder_count,
      track_count: r.wave.track_count,
      batch_count: r.wave.batch_count,
      infer_isolation: r.wave.infer_input_policy,
      note_zh: '下一步：Cursor Agent 填寫 agent-outputs/*-output.json 後執行 g3:e3-run',
    },
    null,
    2
  )
);
