/**
 * G3-E 共用 wave：prepare → ingest Agent JSON → validate → audit → stage
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../../atomic_json.js';
import { prepare_g3_e_batch_inputs } from './g3_e_prepare_batches.js';
import {
  load_g3_e_batch_agent_output,
  G3EAgentOutputMissingError,
} from './g3_e_load_agent_json.js';
import { validate_g3_e2_agent_rows } from './g3_e2_validate.js';
import { run_g3_e_batch_quality, run_g3_e_milestone_quality } from './g3_e_wave_quality.js';
import { FILE_G3_D4_ADOPT_OVERLAY } from '../g3_d/paths_d4.js';
import {
  FILE_G3_E3_INFER_ISOLATION,
  FILE_G3_E3_LEDGER,
  FILE_G3_E3_PENDING,
  FILE_G3_E3_QC_MILESTONES,
} from './paths_e3.js';
import { archive_agent_output_once } from '../g3_f/g3_f_agent_archive.js';
import { build_g3_e1_e2_e3_ledger, compare_d1_d34_e3 } from './g3_e3_compare.js';
import { compare_d1_d34_e2_20 } from './g3_e2_compare.js';

function is_g3_f_wave_key(wave_key) {
  return typeof wave_key === 'string' && /^f\d+$/.test(wave_key);
}

function g3_f_infer_isolation_policy_zh(wave_key) {
  if (wave_key === 'f1') {
    return 'F.1 不含舊 AI 於 infer input；validation 錯誤不覆寫 Agent JSON';
  }
  return (
    'F.' +
    wave_key.slice(1) +
    ' 不含舊 AI 於 infer input；original 目錄不可覆寫；validation 錯誤寫 corrections log'
  );
}

function load_or_init_progress(spec) {
  if (fs.existsSync(spec.file_progress)) {
    return JSON.parse(fs.readFileSync(spec.file_progress, 'utf8'));
  }
  return {
    schema_version: 1,
    wave_key: spec.wave_key,
    tracks: {},
    batches: {},
  };
}

function load_staged_row(spec, track_id) {
  const p = path.join(spec.staged_dir, track_id + '-staged.json');
  if (!fs.existsSync(p)) {
    return null;
  }
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  return doc.inference;
}

/**
 * @param {import('./g3_e_wave_spec.js').G3EWaveSpec} spec
 * @param {object} wave
 * @param {{ write?: boolean, stop_on_qc_fail?: boolean, compare_fn?: Function | null }} [opts]
 */
export function run_g3_e_wave(spec, wave, opts) {
  const options = opts || {};
  const write = options.write !== false;
  const stop_on_qc_fail = options.stop_on_qc_fail !== false;

  const prep = prepare_g3_e_batch_inputs(wave, spec, { write: write });
  let progress = load_or_init_progress(spec);

  /** @type {object[]} */
  const all_rows = [];
  /** @type {object[]} */
  const qc_checkpoints = [];
  /** @type {object[]} */
  const qc_milestones = [];
  let agent_json_count = 0;
  let validate_ok = 0;
  let validate_fail = 0;
  let halted = false;
  let halt_reason_zh = null;
  let gate_first_passed = spec.qc_gate_first ? false : true;

  const input_hash_by_id = {};
  for (let b = 0; b < prep.batch_inputs.length; b += 1) {
    const batch_in = prep.batch_inputs[b];
    for (let t = 0; t < batch_in.tracks.length; t += 1) {
      input_hash_by_id[batch_in.tracks[t].track_id] = batch_in.tracks[t].input_hash;
    }
  }

  for (let bi = 0; bi < wave.batches.length; bi += 1) {
    const batch = wave.batches[bi];
    try {
      const loaded = load_g3_e_batch_agent_output(
        spec,
        batch.batch_id,
        batch.track_ids,
        input_hash_by_id,
        progress
      );

      if (spec.agent_outputs_original_dir && loaded.file_path) {
        archive_agent_output_once(spec, loaded.file_path);
      }

      /** @type {object[]} */
      const batch_rows = [];
      for (let li = 0; li < loaded.loaded.length; li += 1) {
        const item = loaded.loaded[li];
        if (item.skipped_resume) {
          const staged = load_staged_row(spec, item.track_id);
          if (!staged) {
            throw new Error('resume 缺少 staged：' + item.track_id);
          }
          batch_rows.push(staged);
          continue;
        }
        agent_json_count += 1;
        batch_rows.push(item.row);
      }

      if (options.validate_fn) {
        options.validate_fn(batch_rows, batch.track_ids, { batch_id: batch.batch_id });
      } else {
        validate_g3_e2_agent_rows(batch_rows, batch.track_ids);
      }
      validate_ok += batch_rows.length;

      const expect_st = batch.tracks.every(function (t) {
        return (
          (t.cohort && t.cohort.indexOf('soundtrack') >= 0) ||
          t.cohort === 'composer_only_soundtrack'
        );
      });
      const qc = run_g3_e_batch_quality(batch_rows, batch.batch_id, {
        expect_soundtrack_heavy: expect_st,
      });
      qc_checkpoints.push(qc);
      if (!qc.pass && stop_on_qc_fail) {
        halted = true;
        halt_reason_zh = batch.batch_id + ' QC 未通過：' + qc.systemic_flags_zh.join('；');
        break;
      }

      for (let si = 0; si < batch_rows.length; si += 1) {
        const row = batch_rows[si];
        const id = row.track_id;
        const out_hash = loaded.loaded.find(function (x) {
          return x.track_id === id;
        });
        if (write) {
          fs.mkdirSync(spec.staged_dir, { recursive: true });
          write_json_atomic(path.join(spec.staged_dir, id + '-staged.json'), {
            schema_version: 1,
            track_id: id,
            batch_id: batch.batch_id,
            input_hash: input_hash_by_id[id],
            output_hash: out_hash ? out_hash.output_hash : null,
            inference: row,
          });
        }
        progress.tracks[id] = {
          batch_id: batch.batch_id,
          input_hash: input_hash_by_id[id],
          output_hash: out_hash ? out_hash.output_hash : progress.tracks[id].output_hash,
          validation_status: 'ok',
          provenance_status: 'agent_workflow_declared',
          provenance_unverified: true,
          stage_status: 'staged',
          retry_count: progress.tracks[id] ? progress.tracks[id].retry_count || 0 : 0,
          completed_at: new Date().toISOString(),
        };
        all_rows.push(row);
      }

      progress.batches[batch.batch_id] = {
        status: 'completed',
        agent_output_file: loaded.file_path,
        completed_at: new Date().toISOString(),
      };

      if (spec.qc_gate_first && all_rows.length >= spec.qc_gate_first && !gate_first_passed) {
        const ms = run_g3_e_milestone_quality(all_rows.slice(0, spec.qc_gate_first), 'gate-first-' + spec.qc_gate_first);
        qc_milestones.push(ms);
        gate_first_passed = ms.pass;
        if (!ms.pass && stop_on_qc_fail) {
          halted = true;
          halt_reason_zh = '前 ' + spec.qc_gate_first + ' 首里程碑 QC 未通過：' + ms.systemic_flags_zh.join('；');
          break;
        }
      }

      if (
        spec.qc_milestone_every &&
        all_rows.length > 0 &&
        all_rows.length % spec.qc_milestone_every === 0
      ) {
        const ms = run_g3_e_milestone_quality(
          all_rows.slice(0, all_rows.length),
          'every-' + all_rows.length
        );
        qc_milestones.push(ms);
        if (!ms.pass && stop_on_qc_fail) {
          halted = true;
          halt_reason_zh = all_rows.length + ' 首里程碑 QC 未通過：' + ms.systemic_flags_zh.join('；');
          break;
        }
      }
    } catch (e) {
      if (e instanceof G3EAgentOutputMissingError) {
        progress.batches[batch.batch_id] = {
          status: 'awaiting_agent_json',
          error_zh: e.message,
        };
        halted = true;
        halt_reason_zh = e.message;
        validate_fail += batch.track_ids.length;
        break;
      }
      throw e;
    }
  }

  const track_ids = wave.tracks.map(function (t) {
    return t.track_id;
  });
  const staged_ids = all_rows.map(function (r) {
    return r.track_id;
  });

  let comparison = { stats: null, incomplete: true };
  if (options.compare_fn && all_rows.length) {
    comparison = options.compare_fn(all_rows, staged_ids);
  } else if (spec.wave_key === 'e2' && all_rows.length === 20) {
    comparison = compare_d1_d34_e2_20(all_rows, track_ids);
  } else if (spec.wave_key === 'e3' && all_rows.length) {
    comparison = compare_d1_d34_e3(all_rows, staged_ids);
  }

  const provenance_report = {
    schema_version: 1,
    track_count: all_rows.length,
    agent_json_ingested: agent_json_count,
    resume_skipped: all_rows.length - agent_json_count,
    provenance_unverified_all: true,
    note_zh: 'JSON 驗證通過 ≠ 來源已證實；無 session API 紀錄',
  };

  let adopt_disabled = true;
  if (fs.existsSync(FILE_G3_D4_ADOPT_OVERLAY)) {
    adopt_disabled = JSON.parse(fs.readFileSync(FILE_G3_D4_ADOPT_OVERLAY, 'utf8')).enabled !== true;
  }

  const summary = {
    schema_version: 1,
    wave_key: spec.wave_key,
    generated_at: new Date().toISOString(),
    wave_track_count: wave.track_count,
    agent_json_new_count: agent_json_count,
    validate_success: validate_ok,
    validate_fail: validate_fail,
    staged_count: all_rows.length,
    halted: halted,
    halt_reason_zh: halt_reason_zh,
    comparison_stats: comparison.stats || null,
    adopt_disabled: adopt_disabled,
    batches_completed: Object.keys(progress.batches).filter(function (k) {
      return progress.batches[k].status === 'completed';
    }).length,
    batches_awaiting: Object.keys(progress.batches).filter(function (k) {
      return progress.batches[k].status === 'awaiting_agent_json';
    }).length,
  };

  if (write) {
    fs.mkdirSync(spec.wave_dir, { recursive: true });
    write_json_atomic(spec.file_wave, wave);
    write_json_atomic(spec.file_batch_plan, { batches: wave.batches });
    write_json_atomic(spec.file_progress, progress);
    write_json_atomic(spec.file_validate, {
      validate_ok: validate_ok,
      validate_fail: validate_fail,
    });
    write_json_atomic(spec.file_qc, { checkpoints: qc_checkpoints });
    if (is_g3_f_wave_key(spec.wave_key) && spec.file_qc_milestones) {
      write_json_atomic(spec.file_qc_milestones, { milestones: qc_milestones });
    }
    if (is_g3_f_wave_key(spec.wave_key) && spec.file_infer_isolation) {
      write_json_atomic(spec.file_infer_isolation, {
        schema_version: 1,
        include_review_only_suggestions: spec.include_review_only_suggestions,
        policy_zh: g3_f_infer_isolation_policy_zh(spec.wave_key),
        batch_input_field: 'infer_isolation',
        agent_outputs_original_dir: spec.agent_outputs_original_dir || null,
      });
    }
    if (spec.wave_key === 'e3') {
      write_json_atomic(FILE_G3_E3_QC_MILESTONES, { milestones: qc_milestones });
      write_json_atomic(FILE_G3_E3_INFER_ISOLATION, {
        schema_version: 1,
        include_review_only_suggestions: spec.include_review_only_suggestions,
        policy_zh:
          'E.3 批次 input 不含 D.1/D.34 主曲風建議；compare 與 milestone 才對照 D.34',
        batch_input_field: 'infer_isolation',
      });
      const ledger = build_g3_e1_e2_e3_ledger(staged_ids);
      write_json_atomic(FILE_G3_E3_LEDGER, ledger);
      write_json_atomic(FILE_G3_E3_PENDING, {
        pending_count: ledger.pending_e3_count,
        pending_ids: ledger.pending_e3_ids,
      });
    }
    if (all_rows.length) {
      write_json_atomic(spec.file_merged_staged, { tracks: all_rows, count: all_rows.length });
      if (spec.file_comparison) {
        write_json_atomic(spec.file_comparison, comparison);
      }
    }
    write_json_atomic(spec.file_provenance, provenance_report);
    write_json_atomic(spec.file_offline_summary, summary);
  }

  return { summary: summary, wave: wave, progress: progress, comparison: comparison };
}
