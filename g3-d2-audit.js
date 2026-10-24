/**
 * G3-D.2 品質稽核
 */
import { run_g3_d2_audit } from './lib/classification/g3_d/g3_d2_audit.js';
import { run_g3_c1_build } from './lib/classification/g3_c/run_g3_c1_build.js';

const r = run_g3_d2_audit({ write: true });
console.log(JSON.stringify(r.summary, null, 2));
const c1 = run_g3_c1_build({ write: true });
console.log('c1_rebuilt', c1.summary.g3_ai_catalog_track_count);
