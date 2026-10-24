#!/usr/bin/env node
import { prepare_g3_f4 } from './lib/classification/g3_f/run_g3_f4.js';

console.log('[g3-f4-prepare] pid=' + process.pid + ' start');
const r = prepare_g3_f4({ write: true });
if (r.skipped) {
  console.log(JSON.stringify({ skipped: true, reason_zh: r.reason_zh }, null, 2));
  process.exit(0);
}
console.log(
  JSON.stringify(
    {
      prepared: true,
      library_total: r.reconciliation.universe.library_index_ids,
      pending_queue: r.queue.pending_count,
      excluded_prior_f: r.queue.excluded_prior_f_wave_track_count,
      wave_selected: r.wave.track_count,
      batch_count: r.wave.batch_count,
      seed: r.wave.seed,
      phases: r.phases,
    },
    null,
    2
  )
);
