#!/usr/bin/env node
import { run_g3_f4 } from './lib/classification/g3_f/run_g3_f4.js';

console.log('[g3-f4-run] pid=' + process.pid + ' start');
const r = await run_g3_f4({ write: true });
console.log(JSON.stringify(r.summary, null, 2));
