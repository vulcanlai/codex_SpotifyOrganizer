#!/usr/bin/env node
import { run_g3_e1 } from './lib/classification/g3_e/run_g3_e1.js';

const r = run_g3_e1({ write: true });
console.log(JSON.stringify(r.summary, null, 2));
