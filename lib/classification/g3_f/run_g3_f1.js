/**
 * G3-F.1 prepare / run
 */
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { write_json_atomic } from '../../atomic_json.js';
import { build_g3_f1_context } from './g3_f1_context.js';
import { build_g3_f1_full_reconciliation } from './g3_f1_reconcile.js';
import { build_g3_f1_pending_queue } from './g3_f1_queue.js';
import { select_g3_f1_wave } from './g3_f1_wave_select.js';
import { g3_f1_wave_spec } from './g3_f1_wave_spec.js';
import { prepare_g3_e_batch_inputs } from '../g3_e/g3_e_prepare_batches.js';
import { validate_g3_e2_agent_rows } from '../g3_e/g3_e2_validate.js';
import {
  acquire_g3_f1_prepare_lock,
  release_g3_f1_prepare_lock,
} from './g3_f1_prepare_lock.js';
import {
  FILE_G3_F1_FULL_RECONCILE,
  FILE_G3_F1_EXCLUSIVE_STATES,
  FILE_G3_F1_PENDING_QUEUE,
  FILE_G3_F1_WAVE_100,
  FILE_G3_F1_BATCH_PLAN,
  FILE_G3_F1_REMAINING,
  FILE_G3_F1_PREPARE_TIMING,
  FILE_G3_F1_VALIDATION_CORRECTIONS,
  G3_F1_WAVE_DIR,
} from './paths_f1.js';

function phase_log(phases, name, t0) {
  const ms = Math.round(performance.now() - t0);
  phases.push({ phase: name, duration_ms: ms });
  console.log('[g3-f1-prepare] ' + name + ': ' + ms + 'ms');
  return performance.now();
}

/**
 * 唯讀 reconcile + queue（不寫檔）
 */
export function dry_run_g3_f1_reconcile() {
  const t0 = performance.now();
  const ctx = build_g3_f1_context();
  const t1 = performance.now();
  const recon = build_g3_f1_full_reconciliation(ctx);
  const t2 = performance.now();
  const queue = build_g3_f1_pending_queue(ctx, { exclude_prior_f_waves: false });
  const t3 = performance.now();
  return {
    reconciliation: recon,
    queue: queue,
    timing_ms: {
      load_context: Math.round(t1 - t0),
      reconcile: Math.round(t2 - t1),
      queue: Math.round(t3 - t2),
      total: Math.round(t3 - t0),
    },
  };
}

/**
 * @param {{ write?: boolean, input_batch_limit?: number | null }} [opts]
 */
export function prepare_g3_f1(opts) {
  const options = opts || {};
  const write = options.write !== false;
  const spec = g3_f1_wave_spec();
  /** @type {object[]} */
  const phases = [];
  let t = performance.now();

  if (write) {
    acquire_g3_f1_prepare_lock(spec);
  }

  try {
    const ctx = build_g3_f1_context();
    t = phase_log(phases, 'load_context', t);

    const recon = build_g3_f1_full_reconciliation(ctx);
    t = phase_log(phases, 'reconcile_readonly', t);

    const queue = build_g3_f1_pending_queue(ctx, { exclude_prior_f_waves: false });
    t = phase_log(phases, 'build_queue', t);

    const wave = select_g3_f1_wave(queue);
    t = phase_log(phases, 'select_wave', t);

    let input_limit = options.input_batch_limit;
    if (input_limit == null && process.env.G3_F1_PREPARE_INPUT_BATCHES) {
      input_limit = parseInt(process.env.G3_F1_PREPARE_INPUT_BATCHES, 10);
    }
    if (input_limit == null) {
      input_limit = wave.batch_count;
    }

    if (write) {
      fs.mkdirSync(spec.wave_dir, { recursive: true });
      write_json_atomic(FILE_G3_F1_FULL_RECONCILE, recon);
      write_json_atomic(FILE_G3_F1_EXCLUSIVE_STATES, recon.exclusive_primary_states);
      write_json_atomic(FILE_G3_F1_PENDING_QUEUE, queue);
      write_json_atomic(spec.file_wave, wave);
      write_json_atomic(FILE_G3_F1_WAVE_100, wave);
      write_json_atomic(spec.file_batch_plan, { batches: wave.batches });
      const wave_ids = {};
      for (let i = 0; i < wave.tracks.length; i += 1) {
        wave_ids[wave.tracks[i].track_id] = true;
      }
      const remaining = queue.pending_tracks.filter(function (r) {
        return !wave_ids[r.track_id];
      });
      write_json_atomic(FILE_G3_F1_REMAINING, {
        schema_version: 1,
        remaining_count: remaining.length,
        remaining_tracks: remaining,
      });
      t = phase_log(phases, 'write_metadata', t);
    }

    const wave_for_inputs = Object.assign({}, wave, {
      batches: wave.batches.slice(0, Math.max(0, input_limit)),
    });
    prepare_g3_e_batch_inputs(wave_for_inputs, spec, { write: write });
    t = phase_log(phases, 'write_batch_inputs_' + wave_for_inputs.batches.length, t);

    if (write) {
      write_json_atomic(FILE_G3_F1_PREPARE_TIMING, {
        schema_version: 1,
        phases: phases,
        input_batches_written: wave_for_inputs.batches.length,
        wave_track_count: wave.track_count,
      });
    }

    return { reconciliation: recon, queue: queue, wave: wave, phases: phases };
  } finally {
    if (write) {
      release_g3_f1_prepare_lock();
    }
  }
}

/**
 * @param {{ write?: boolean, stop_on_qc_fail?: boolean }} [opts]
 */
export async function run_g3_f1(opts) {
  const options = opts || {};
  const write = options.write !== false;
  const spec = g3_f1_wave_spec();
  const ctx = build_g3_f1_context();
  const queue = build_g3_f1_pending_queue(ctx, { exclude_prior_f_waves: false });
  const wave = select_g3_f1_wave(queue);

  const { run_g3_e_wave } = await import('../g3_e/run_g3_e_wave.js');

  const r = run_g3_e_wave(spec, wave, {
    write: write,
    stop_on_qc_fail: options.stop_on_qc_fail !== false,
    validate_fn: function (rows, track_ids) {
      try {
        return validate_g3_e2_agent_rows(rows, track_ids);
      } catch (e) {
        if (write) {
          fs.mkdirSync(G3_F1_WAVE_DIR, { recursive: true });
          write_json_atomic(FILE_G3_F1_VALIDATION_CORRECTIONS, {
            schema_version: 1,
            at: new Date().toISOString(),
            error_message: String(e && e.message ? e.message : e),
            agent_original_preserved: true,
            note_zh: '請 Agent 修正 output 後重跑；驗證器不得靜默改寫主曲風',
          });
        }
        throw e;
      }
    },
  });

  return {
    summary: r.summary,
    wave: r.wave,
    progress: r.progress,
    reconciliation: build_g3_f1_full_reconciliation(ctx),
    queue: queue,
  };
}
