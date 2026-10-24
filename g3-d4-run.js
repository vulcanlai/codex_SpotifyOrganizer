#!/usr/bin/env node
/**
 * G3-D.4 CLI
 */
import { run_g3_d4 } from './lib/classification/g3_d/run_g3_d4.js';

const args = process.argv.slice(2);
let max_batch = 17;
for (let i = 0; i < args.length; i += 1) {
  if (args[i].indexOf('--max-batch=') === 0) {
    max_batch = parseInt(args[i].split('=')[1], 10);
  }
}

const r = run_g3_d4({ write: true, max_batch: max_batch });
console.log(JSON.stringify(r.summary, null, 2));
if (r.summary.halted) {
  process.exitCode = 2;
}
