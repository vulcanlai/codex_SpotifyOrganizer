#!/usr/bin/env node
import { run_g3_f6 } from './lib/classification/g3_f/run_g3_f6.js';

console.log('[g3-f6-run] pid=' + process.pid + ' start');
const r = await run_g3_f6({ write: true });
console.log(JSON.stringify(r.summary, null, 2));
