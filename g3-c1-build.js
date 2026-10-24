import { run_g3_c1_build } from './lib/classification/g3_c/run_g3_c1_build.js';

const r = run_g3_c1_build({ write: true });
console.log(JSON.stringify(r, null, 2));
