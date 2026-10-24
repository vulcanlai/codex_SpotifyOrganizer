#!/usr/bin/env node
import { run_g3_e2 } from './lib/classification/g3_e/run_g3_e2.js';

const r = run_g3_e2({ write: true });
console.log(JSON.stringify(r.summary, null, 2));
if (r.summary.halted) {
  process.exitCode = 2;
}
