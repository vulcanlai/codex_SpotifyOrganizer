/**
 * G3-D.1 離線計畫
 */
import { run_g3_d1_offline_plan } from './lib/classification/g3_d/run_g3_d1_offline_plan.js';

const r = run_g3_d1_offline_plan({ write: true });
console.log(JSON.stringify(r.summary, null, 2));
