/**
 * G3-F.3 prepare / run
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { write_json_atomic } from '../../atomic_json.js';
import { build_g3_f1_context } from './g3_f1_context.js';
import { build_g3_f1_full_reconciliation } from './g3_f1_reconcile.js';
import { build_g3_f1_pending_queue } from './g3_f1_queue.js';
import { select_g3_f_wave } from './g3_f1_wave_select.js';
import { g3_f3_wave_spec } from './g3_f3_wave_spec.js';
import { prepare_g3_e_batch_inputs } from '../g3_e/g3_e_prepare_batches.js';
import { validate_g3_e2_agent_rows } from '../g3_e/g3_e2_validate.js';
import {
  acquire_g3_f_prepare_lock,
  release_g3_f_prepare_lock,
} from './g3_f_prepare_lock.js';
import { load_prior_g3_f_wave_track_ids } from './g3_f_prior_waves.js';
import {
  append_validation_correction,
  init_validation_corrections_log,
} from './g3_f_agent_archive.js';
import {
  FILE_G3_F3_FULL_RECONCILE,
  FILE_G3_F3_EXCLUSIVE_STATES,
  FILE_G3_F3_PENDING_QUEUE,
  FILE_G3_F3_WAVE_100,
  FILE_G3_F3_BATCH_PLAN,
  FILE_G3_F3_REMAINING,
  FILE_G3_F3_PREPARE_TIMING,
  FILE_G3_F3_WAVE_EXCLUSIONS,
  G3_F3_WAVE_DIR,
  G3_F3_WAVE_SEED,
  G3_F3_WAVE_SIZE,
  G3_F3_BATCH_SIZE,
  G3_F3_BATCH_ID_PREFIX,
  FILE_G3_F3_PREPARE_LOCK,
  FILE_G3_F3_VALIDATION_CORRECTIONS,
} from './paths_f3.js';

function phase_log(phases, name, t0, tag) {
  const ms = Math.round(performance.now() - t0);
  phases.push({ phase: name, duration_ms: ms });
  console.log('[' + tag + '-prepare] ' + name + ': ' + ms + 'ms');
  return performance.now();
}

function f3_select_config() {
  return {
    seed: G3_F3_WAVE_SEED,
    wave_id: 'g3-f3-wave-100',
    wave_size: G3_F3_WAVE_SIZE,
    batch_size: G3_F3_BATCH_SIZE,
    batch_id_prefix: G3_F3_BATCH_ID_PREFIX,
    cohort: 'g3_f3_pending_queue',
  };
}

function is_g3_f3_wave_staged_complete(spec) {
  if (!fs.existsSync(spec.file_wave)) {
    return false;
  }
  const wave = JSON.parse(fs.readFileSync(spec.file_wave, 'utf8'));
  const staged_dir = path.join(spec.wave_dir, 'staged-candidates');
  if (!fs.existsSync(staged_dir)) {
    return false;
  }
  const staged_n = fs
    .readdirSync(staged_dir)
    .filter(function (f) {
      return f.endsWith('-staged.json');
    }).length;
  return staged_n >= (wave.track_count || 0) && wave.track_count > 0;
}

export function dry_run_g3_f3_reconcile() {
  const t0 = performance.now();
  const ctx = build_g3_f1_context();
  const t1 = performance.now();
  const recon = build_g3_f1_full_reconciliation(ctx);
  const t2 = performance.now();
  const queue = build_g3_f1_pending_queue(ctx, { exclude_prior_f_waves: true });
  const t3 = performance.now();
  const prior = load_prior_g3_f_wave_track_ids();
  return {
    reconciliation: recon,
    queue: queue,
    prior_f_waves: prior.waves,
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
export function prepare_g3_f3(opts) {
  const options = opts || {};
  const write = options.write !== false;
  const spec = g3_f3_wave_spec();
  /** @type {object[]} */
  const phases = [];
  let t = performance.now();

  if (write) {
    acquire_g3_f_prepare_lock({ wave_dir: G3_F3_WAVE_DIR, lock_file: FILE_G3_F3_PREPARE_LOCK });
  }

  if (write && is_g3_f3_wave_staged_complete(spec)) {
    release_g3_f_prepare_lock({ lock_file: FILE_G3_F3_PREPARE_LOCK });
    return {
      skipped: true,
      reason_zh: 'wave 已 staged 完成；prepare 略過以免覆寫 wave 抽樣',
      spec: spec,
    };
  }

  try {
    const ctx = build_g3_f1_context();
    t = phase_log(phases, 'load_context', t, 'g3-f3');

    const recon = build_g3_f1_full_reconciliation(ctx);
    t = phase_log(phases, 'reconcile_readonly', t, 'g3-f3');

    const queue = build_g3_f1_pending_queue(ctx, { exclude_prior_f_waves: true });
    t = phase_log(phases, 'build_queue', t, 'g3-f3');

    const wave = select_g3_f_wave(queue, f3_select_config());
    t = phase_log(phases, 'select_wave', t, 'g3-f3');

    const prior = load_prior_g3_f_wave_track_ids();

    let input_limit = options.input_batch_limit;
    if (input_limit == null && process.env.G3_F3_PREPARE_INPUT_BATCHES) {
      input_limit = parseInt(process.env.G3_F3_PREPARE_INPUT_BATCHES, 10);
    }
    if (input_limit == null) {
      input_limit = wave.batch_count;
    }

    if (write) {
      fs.mkdirSync(spec.wave_dir, { recursive: true });
      write_json_atomic(FILE_G3_F3_FULL_RECONCILE, recon);
      write_json_atomic(FILE_G3_F3_EXCLUSIVE_STATES, recon.exclusive_primary_states);
      write_json_atomic(FILE_G3_F3_PENDING_QUEUE, queue);
      write_json_atomic(spec.file_wave, wave);
      write_json_atomic(FILE_G3_F3_WAVE_100, wave);
      write_json_atomic(spec.file_batch_plan, { batches: wave.batches });
      write_json_atomic(FILE_G3_F3_WAVE_EXCLUSIONS, {
        schema_version: 1,
        prior_f_waves: prior.waves,
        excluded_prior_f_wave_track_count: queue.excluded_prior_f_wave_track_count,
        queue_filters: queue.filters_applied_zh,
        note_zh: 'F.3 自排除 F.1/F.2 後的 pending 池抽樣；rule primary 僅供多樣性',
      });
      const wave_ids = {};
      for (let i = 0; i < wave.tracks.length; i += 1) {
        wave_ids[wave.tracks[i].track_id] = true;
      }
      const remaining = queue.pending_tracks.filter(function (r) {
        return !wave_ids[r.track_id];
      });
      write_json_atomic(FILE_G3_F3_REMAINING, {
        schema_version: 1,
        remaining_count: remaining.length,
        remaining_tracks: remaining,
      });
      init_validation_corrections_log(FILE_G3_F3_VALIDATION_CORRECTIONS);
      t = phase_log(phases, 'write_metadata', t, 'g3-f3');
    }

    const wave_for_inputs = Object.assign({}, wave, {
      batches: wave.batches.slice(0, Math.max(0, input_limit)),
    });
    prepare_g3_e_batch_inputs(wave_for_inputs, spec, { write: write });
    t = phase_log(phases, 'write_batch_inputs_' + wave_for_inputs.batches.length, t, 'g3-f3');

    if (write) {
      write_json_atomic(FILE_G3_F3_PREPARE_TIMING, {
        schema_version: 1,
        phases: phases,
        input_batches_written: wave_for_inputs.batches.length,
        wave_track_count: wave.track_count,
      });
    }

    return { reconciliation: recon, queue: queue, wave: wave, phases: phases, prior_f_waves: prior.waves };
  } finally {
    if (write) {
      release_g3_f_prepare_lock({ lock_file: FILE_G3_F3_PREPARE_LOCK });
    }
  }
}

/**
 * @param {{ write?: boolean, stop_on_qc_fail?: boolean }} [opts]
 */
export async function run_g3_f3(opts) {
  const options = opts || {};
  const write = options.write !== false;
  const spec = g3_f3_wave_spec();
  const ctx = build_g3_f1_context();
  const queue = build_g3_f1_pending_queue(ctx, { exclude_prior_f_waves: true });

  let wave;
  if (fs.existsSync(spec.file_wave)) {
    wave = JSON.parse(fs.readFileSync(spec.file_wave, 'utf8'));
  } else {
    wave = select_g3_f_wave(queue, f3_select_config());
  }

  const { run_g3_e_wave } = await import('../g3_e/run_g3_e_wave.js');

  const r = run_g3_e_wave(spec, wave, {
    write: write,
    stop_on_qc_fail: options.stop_on_qc_fail !== false,
    validate_fn: function (rows, track_ids, meta) {
      try {
        return validate_g3_e2_agent_rows(rows, track_ids);
      } catch (e) {
        if (write && spec.file_validation_corrections) {
          append_validation_correction(spec.file_validation_corrections, {
            at: new Date().toISOString(),
            batch_id: meta && meta.batch_id ? meta.batch_id : null,
            track_ids: track_ids,
            error_message: String(e && e.message ? e.message : e),
            agent_original_preserved: true,
            note_zh: '請 Agent 修正 output 後重跑；不得靜默改寫',
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
