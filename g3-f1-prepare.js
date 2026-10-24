#!/usr/bin/env node
import { prepare_g3_f1 } from './lib/classification/g3_f/run_g3_f1.js';

console.log('[g3-f1-prepare] pid=' + process.pid + ' start');
const r = prepare_g3_f1({ write: true });
console.log(
  JSON.stringify(
    {
      prepared: true,
      library_total: r.reconciliation.universe.library_index_ids,
      wave_eligible: r.reconciliation.overlap_flags.wave_eligible_new_ai,
      pending_queue: r.queue.pending_count,
      wave_selected: r.wave.track_count,
      batch_count: r.wave.batch_count,
      phases: r.phases,
    },
    null,
    2
  )
);
