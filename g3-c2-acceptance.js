import { run_g3_c2_acceptance } from './lib/classification/g3_c/run_g3_c2_acceptance.js';

console.log(JSON.stringify(run_g3_c2_acceptance({ write: true }).summary, null, 2));
