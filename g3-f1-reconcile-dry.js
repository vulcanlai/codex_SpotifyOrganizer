#!/usr/bin/env node
import { dry_run_g3_f1_reconcile } from './lib/classification/g3_f/run_g3_f1.js';

const r = dry_run_g3_f1_reconcile();
console.log(
  JSON.stringify(
    {
      dry_run: true,
      timing_ms: r.timing_ms,
      universe: r.reconciliation.universe.library_index_ids,
      wave_eligible: r.reconciliation.overlap_flags.wave_eligible_new_ai,
      pending_queue: r.queue.pending_count,
      exclusive_sum: r.reconciliation.exclusive_primary_states.sum_check,
      recalculated: r.reconciliation.recalculated_reference,
    },
    null,
    2
  )
);
