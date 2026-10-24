#!/usr/bin/env node
import { dry_run_g3_f3_reconcile } from './lib/classification/g3_f/run_g3_f3.js';

const r = dry_run_g3_f3_reconcile();
console.log(
  JSON.stringify(
    {
      library_total: r.reconciliation.universe.library_index_ids,
      wave_eligible_overlap: r.reconciliation.overlap_flags.wave_eligible_new_ai,
      pending_queue_f3: r.queue.pending_count,
      excluded_prior_f: r.queue.excluded_prior_f_wave_track_count,
      prior_waves: r.prior_f_waves,
      timing_ms: r.timing_ms,
    },
    null,
    2
  )
);
