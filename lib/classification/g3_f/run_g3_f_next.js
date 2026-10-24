/**
 * G3-F 通用 CLI 邏輯（g3-f-next.js）
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  resolve_next_g3_f_wave,
  read_g3_f_wave_status,
  get_g3_f_wave_size_on_disk,
  G3_F_WAVE_SIZE_MAX,
} from './g3_f_wave_manifest.js';
import {
  dry_run_g3_f_dynamic_reconcile,
  prepare_g3_f_dynamic,
  run_g3_f_dynamic,
} from './run_g3_f_dynamic.js';
import {
  emit_g3_f_agent_outputs,
  load_merged_agent_decisions_from_wave_dir,
} from './g3_f_emit_agent_outputs.js';
import { build_g3_f_paths } from './g3_f_paths_dynamic.js';
import { G3_F1_BATCH_SIZE } from './paths_f1.js';

/**
 * @param {string[]} argv
 */
export function parse_g3_f_next_args(argv) {
  const args = argv || [];
  /** @type {Record<string, string | boolean | number | null>} */
  const out = {
    dry_run: false,
    prepare: false,
    emit: false,
    run: false,
    count: 100,
    wave: null,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--dry-run') {
      out.dry_run = true;
    } else if (a === '--prepare') {
      out.prepare = true;
    } else if (a === '--emit-agent-outputs' || a === '--emit') {
      out.emit = true;
    } else if (a === '--run') {
      out.run = true;
    } else if (a.indexOf('--count=') === 0) {
      out.count = parseInt(a.slice('--count='.length), 10);
    } else if (a.indexOf('--wave=') === 0) {
      out.wave = parseInt(a.slice('--wave='.length), 10);
    }
  }
  if (!out.prepare && !out.emit && !out.run) {
    out.dry_run = true;
  }
  return out;
}

/**
 * @param {number} track_count
 * @param {number} batch_size
 */
export function plan_g3_f_batch_layout(track_count, batch_size) {
  const batch_count = Math.ceil(track_count / batch_size);
  /** @type {number[]} */
  const batch_sizes = [];
  for (let b = 0; b < batch_count; b += 1) {
    const start = b * batch_size;
    batch_sizes.push(Math.min(batch_size, track_count - start));
  }
  return { batch_count: batch_count, batch_sizes: batch_sizes };
}

/**
 * @param {ReturnType<typeof parse_g3_f_next_args>} cli
 */
export async function execute_g3_f_next(cli) {
  if (!Number.isFinite(cli.count) || cli.count < 1 || cli.count > G3_F_WAVE_SIZE_MAX) {
    throw new Error('--count 須為 1～' + G3_F_WAVE_SIZE_MAX + ' 的整數');
  }

  const recon = dry_run_g3_f_dynamic_reconcile();
  const pending_count = recon.queue.pending_count;

  const resolved = resolve_next_g3_f_wave({
    force_wave_number: cli.wave,
    requested_wave_size: cli.count,
    pending_count: pending_count,
  });
  const n = resolved.wave_number;
  const wave_size = resolved.wave_size;
  const paths = resolved.paths;

  const batch_plan = plan_g3_f_batch_layout(wave_size, G3_F1_BATCH_SIZE);

  /** @type {object} */
  const report = {
    resolved: {
      wave_number: n,
      wave_size: wave_size,
      wave_id: paths.wave_id,
      wave_dir: paths.wave_dir,
      mode: resolved.mode,
      reason_zh: resolved.reason_zh,
      batch_size: G3_F1_BATCH_SIZE,
      batch_count_planned: batch_plan.batch_count,
      batch_track_counts: batch_plan.batch_sizes,
    },
    actions: [],
  };

  report.reconcile = {
    library_total: recon.reconciliation.universe.library_index_ids,
    pending_queue: pending_count,
    excluded_prior_f: recon.queue.excluded_prior_f_wave_track_count,
    prior_waves: recon.prior_f_waves,
  };

  if (cli.prepare && resolved.mode === 'new_wave' && pending_count < 1) {
    throw new Error('pending 佇列為 0，無法 prepare 新波次');
  }
  if (cli.prepare && wave_size < 1) {
    throw new Error('有效 wave_size 為 0（pending=' + pending_count + '）；請確認 --count');
  }

  if (cli.dry_run && !cli.prepare && !cli.emit && !cli.run) {
    report.status = read_g3_f_wave_status(n, wave_size);
    return report;
  }

  if (cli.prepare) {
    const prep = prepare_g3_f_dynamic(n, { write: true, wave_size: wave_size });
    report.actions.push({ prepare: prep.skipped ? { skipped: prep.reason_zh } : { ok: true } });
    if (prep.wave) {
      report.resolved.actual_track_count = prep.wave.track_count;
      report.resolved.batch_count_actual = prep.wave.batch_count;
    }
  }

  if (cli.emit) {
    const merged = load_merged_agent_decisions_from_wave_dir(n, wave_size);
    const expected = JSON.parse(fs.readFileSync(paths.file_wave, 'utf8'));
    const ids = expected.track_ids || expected.tracks.map(function (t) {
      return t.track_id;
    });
    for (let i = 0; i < ids.length; i += 1) {
      if (!merged[ids[i]]) {
        throw new Error('agent-decisions 缺少 track_id：' + ids[i]);
      }
    }
    const em = emit_g3_f_agent_outputs(n, merged, { write: true, wave_size: wave_size });
    report.actions.push({ emit: em });
  }

  if (cli.run) {
    if (!fs.existsSync(paths.agent_outputs_dir)) {
      throw new Error('缺少 agent-outputs；請先 --emit-agent-outputs');
    }
    const outputs = fs.readdirSync(paths.agent_outputs_dir).filter(function (f) {
      return f.endsWith('-output.json');
    });
    if (!outputs.length) {
      throw new Error('agent-outputs 為空；不得 run');
    }
    const r = await run_g3_f_dynamic(n, { write: true, wave_size: wave_size });
    report.actions.push({ run: r.summary });
  }

  report.status = read_g3_f_wave_status(n, wave_size);
  return report;
}

/**
 * 列出 batch input 摘要（供 Agent 填決策）
 * @param {number} wave_number
 * @param {number} [wave_size]
 */
export function summarize_g3_f_batch_inputs(wave_number, wave_size) {
  const size = wave_size || get_g3_f_wave_size_on_disk(wave_number) || 100;
  const paths = build_g3_f_paths(wave_number, size);
  const files = fs.readdirSync(paths.batch_inputs_dir).filter(function (f) {
    return f.endsWith('-input.json');
  });
  /** @type {object[]} */
  const lines = [];
  for (let i = 0; i < files.length; i += 1) {
    const doc = JSON.parse(
      fs.readFileSync(path.join(paths.batch_inputs_dir, files[i]), 'utf8')
    );
    for (let t = 0; t < doc.tracks.length; t += 1) {
      const tr = doc.tracks[t];
      const id = tr.track_id;
      const title = tr.identity && tr.identity.title;
      const artists = (tr.identity && tr.identity.artists) || [];
      lines.push({
        batch_id: doc.batch_id,
        track_id: id,
        title: title,
        artists: artists.slice(0, 2).join('/'),
        album: tr.identity && tr.identity.album_name,
      });
    }
  }
  return lines;
}
