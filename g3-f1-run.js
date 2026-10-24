#!/usr/bin/env node
import { run_g3_f1 } from './lib/classification/g3_f/run_g3_f1.js';

const r = await run_g3_f1({ write: true });
console.log(JSON.stringify(r.summary, null, 2));
if (r.summary.halted) {
  process.exitCode = 2;
}
