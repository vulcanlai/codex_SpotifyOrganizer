import { run_g3_b51_diagnostic } from './lib/classification/g3_b/run_g3_b51_diagnostic.js';

const r = run_g3_b51_diagnostic({ write: true });
console.log(JSON.stringify(r.summary, null, 2));
