import { generate_all_g3_b6_drafts } from './lib/classification/g3_b/g3_b6_generate_drafts.js';

console.log(JSON.stringify(generate_all_g3_b6_drafts({ write: true }), null, 2));
