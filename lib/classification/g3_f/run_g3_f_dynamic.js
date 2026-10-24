/**
 * G3-F 通用 prepare / reconcile / run（F.7+；不取代 run_g3_f1～f6）
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { write_json_atomic } from '../../atomic_json.js';
import { build_g3_f1_context } from './g3_f1_context.js';
import { build_g3_f1_full_reconciliation } from './g3_f1_reconcile.js';
import { build_g3_f1_pending_queue } from './g3_f1_queue.js';
import { select_g3_f_wave } from './g3_f1_wave_select.js';
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
import { build_g3_f_wave_spec } from './g3_f_wave_spec_factory.js';
import { build_g3_f_paths } from './g3_f_paths_dynamic.js';
import {
  is_g3_f_wave_staged_complete,
  write_g3_f_wave_manifest,
} from './g3_f_wave_manifest.js';

function phase_log(phases, name, t0, tag) {
  const ms = Math.round(performance.now() - t0);
  phases.push({ phase: name, duration_ms: ms });
  console.log('[' + tag + '-prepare] ' + name + ': ' + ms + 'ms');
  return performance.now();
}

/**
 * @param {number} wave_number
 * @param {number} wave_size
 */
function f_select_config(wave_number, wave_size) {
  const p = build_g3_f_paths(wave_number, wave_size);
  return {
    seed: p.wave_seed,
    wave_id: p.wave_id,
    wave_size: wave_size,
    batch_size: p.batch_size,
    batch_id_prefix: p.batch_id_prefix,
    cohort: 'g3_f' + wave_number + '_pending_queue',
  };
}

export function dry_run_g3_f_dynamic_reconcile() {
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
 * @param {number} wave_number
 * @param {{ write?: boolean, wave_size?: number, input_batch_limit?: number | null }} [opts]
 */
export function prepare_g3_f_dynamic(wave_number, opts) {
  const options = opts || {};
  const write = options.write !== false;
  const wave_size = options.wave_size || 100;
  const paths = build_g3_f_paths(wave_number, wave_size);
  const spec = build_g3_f_wave_spec(wave_number, wave_size);
  /** @type {object[]} */
  const phases = [];
  let t = performance.now();
  const tag = 'g3-f' + wave_number;

  if (write) {
    acquire_g3_f_prepare_lock({
      wave_dir: paths.wave_dir,
      lock_file: paths.file_prepare_lock,
    });
  }

  if (write && is_g3_f_wave_staged_complete(paths.wave_dir, wave_size)) {
    release_g3_f_prepare_lock({ lock_file: paths.file_prepare_lock });
    return {
      skipped: true,
      wave_number: wave_number,
      reason_zh: 'G3-F.' + wave_number + ' 已 staged 完成；prepare 略過以免覆寫 wave 抽樣',
      spec: spec,
    };
  }

  try {
    const ctx = build_g3_f1_context();
    t = phase_log(phases, 'load_context', t, tag);

    const recon = build_g3_f1_full_reconciliation(ctx);
    t = phase_log(phases, 'reconcile_readonly', t, tag);

    const queue = build_g3_f1_pending_queue(ctx, { exclude_prior_f_waves: true });
    t = phase_log(phases, 'build_queue', t, tag);

    const wave = select_g3_f_wave(queue, f_select_config(wave_number, wave_size));
    t = phase_log(phases, 'select_wave', t, tag);

    const prior = load_prior_g3_f_wave_track_ids();

    let input_limit = options.input_batch_limit;
    if (input_limit == null) {
      input_limit = wave.batch_count;
    }

    if (write) {
      fs.mkdirSync(spec.wave_dir, { recursive: true });
      write_json_atomic(paths.file_full_reconcile, recon);
      write_json_atomic(paths.file_exclusive_states, recon.exclusive_primary_states);
      write_json_atomic(paths.file_pending_queue, queue);
      write_json_atomic(spec.file_wave, wave);
      write_json_atomic(paths.file_batch_plan, { batches: wave.batches });
      write_json_atomic(paths.file_wave_exclusions, {
        schema_version: 1,
        prior_f_waves: prior.waves,
        excluded_prior_f_wave_track_count: queue.excluded_prior_f_wave_track_count,
        queue_filters: queue.filters_applied_zh,
        note_zh:
          'F.' +
          wave_number +
          ' 自排除既有 F waves 後的 pending 池抽樣；rule primary 僅供多樣性',
      });
      const wave_ids = {};
      for (let i = 0; i < wave.tracks.length; i += 1) {
        wave_ids[wave.tracks[i].track_id] = true;
      }
      const remaining = queue.pending_tracks.filter(function (r) {
        return !wave_ids[r.track_id];
      });
      write_json_atomic(paths.file_remaining, {
        schema_version: 1,
        remaining_count: remaining.length,
        remaining_tracks: remaining,
      });
      init_validation_corrections_log(paths.file_validation_corrections);
      write_g3_f_wave_manifest(paths, {
        status: 'prepared',
        prepared_at: new Date().toISOString(),
        queue_pending_at_prepare: queue.pending_count,
        track_count: wave.track_count,
      });
      t = phase_log(phases, 'write_metadata', t, tag);
    }

    const wave_for_inputs = Object.assign({}, wave, {
      batches: wave.batches.slice(0, Math.max(0, input_limit)),
    });
    prepare_g3_e_batch_inputs(wave_for_inputs, spec, { write: write });
    t = phase_log(
      phases,
      'write_batch_inputs_' + wave_for_inputs.batches.length,
      t,
      tag
    );

    if (write) {
      write_json_atomic(paths.file_prepare_timing, {
        schema_version: 1,
        phases: phases,
        input_batches_written: wave_for_inputs.batches.length,
        wave_track_count: wave.track_count,
      });
    }

    return {
      wave_number: wave_number,
      reconciliation: recon,
      queue: queue,
      wave: wave,
      phases: phases,
      prior_f_waves: prior.waves,
    };
  } finally {
    if (write) {
      release_g3_f_prepare_lock({ lock_file: paths.file_prepare_lock });
    }
  }
}

/**
 * @param {number} wave_number
 * @param {{ write?: boolean, wave_size?: number, stop_on_qc_fail?: boolean }} [opts]
 */
export async function run_g3_f_dynamic(wave_number, opts) {
  const options = opts || {};
  const write = options.write !== false;
  const wave_size = options.wave_size || 100;
  const spec = build_g3_f_wave_spec(wave_number, wave_size);
  const paths = build_g3_f_paths(wave_number, wave_size);
  const ctx = build_g3_f1_context();
  const queue = build_g3_f1_pending_queue(ctx, { exclude_prior_f_waves: true });

  let wave;
  if (fs.existsSync(spec.file_wave)) {
    wave = JSON.parse(fs.readFileSync(spec.file_wave, 'utf8'));
  } else {
    wave = select_g3_f_wave(queue, f_select_config(wave_number, wave_size));
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

  if (write && r.summary && r.summary.staged_count >= (wave.track_count || wave_size)) {
    write_g3_f_wave_manifest(paths, {
      status: 'staged_complete',
      staged_at: new Date().toISOString(),
      offline_summary: r.summary,
    });
  }

  return {
    summary: r.summary,
    wave: r.wave,
    progress: r.progress,
    wave_number: wave_number,
    reconciliation: build_g3_f1_full_reconciliation(ctx),
    queue: queue,
  };
}
