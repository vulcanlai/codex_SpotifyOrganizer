#!/usr/bin/env node
import { run_g3_d5 } from './lib/classification/g3_d/run_g3_d5.js';

const r = run_g3_d5({ write: true });
console.log(JSON.stringify(r.summary, null, 2));
