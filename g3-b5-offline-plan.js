import { run_g3_b5_offline_plan } from './lib/classification/g3_b/run_g3_b5_offline_plan.js';

const r = run_g3_b5_offline_plan({ write: true });
console.log(JSON.stringify(r.summary, null, 2));
