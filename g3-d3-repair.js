import { run_g3_d3_repair } from './lib/classification/g3_d/run_g3_d3_repair.js';

const r = run_g3_d3_repair({ write: true });
console.log(JSON.stringify(r.summary, null, 2));
