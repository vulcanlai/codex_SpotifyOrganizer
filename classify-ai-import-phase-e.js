/**
 * npm run classify:ai-import-phase-e
 */
import { import_phase_e_candidates } from './lib/classification/phase_e_import.js';
import { PhaseEImportError } from './lib/classification/phase_e_import.js';

function main() {
  try {
    const r = import_phase_e_candidates({ write: true });
    console.log('\n========== phase-e 匯入 ==========');
    if (r.idempotent) {
      console.log('idempotent：候選未變更');
    } else {
      console.log('已匯入候選數：', r.candidate_count);
    }
    console.log('==================================\n');
  } catch (err) {
    if (err instanceof PhaseEImportError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

main();
