/**
 * G3-E.1 主流程 prepare → infer → validate → audit → stage
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { build_g3_e1_pipeline_flow_analysis } from './g3_e1_flow_analysis.js';
import { select_g3_e1_pilot_5 } from './g3_e1_sample_5.js';
import { prepare_g3_e1_inputs } from './g3_e1_prepare.js';
import { run_g3_e1_infer } from './g3_e1_infer.js';
import { validate_g3_e1_inferences } from './g3_e1_validate_stage.js';
import { audit_g3_e1_run } from './g3_e1_audit.js';
import { compare_d1_d34_e1 } from './g3_e1_compare.js';
import { build_g3_e1_continuation_plan } from './g3_e1_continuation_plan.js';
import {
  G3_E1_DIR,
  FILE_G3_E1_FLOW_ANALYSIS,
  FILE_G3_E1_SAMPLE_5,
  FILE_G3_E1_INPUT_MANIFEST,
  FILE_G3_E1_INFER_MANIFEST,
  FILE_G3_E1_VALIDATE_REPORT,
  FILE_G3_E1_AUDIT_REPORT,
  FILE_G3_E1_COMPARISON,
  FILE_G3_E1_CONTINUATION_PLAN,
  FILE_G3_E1_OFFLINE_SUMMARY,
} from './paths_e1.js';
import { FILE_G3_D4_ADOPT_OVERLAY } from '../g3_d/paths_d4.js';

/**
 * @param {{ write?: boolean, skip_infer?: boolean }} [opts]
 */
export function run_g3_e1(opts) {
  const options = opts || {};
  const write = options.write !== false;

  const flow = build_g3_e1_pipeline_flow_analysis();
  const sample = select_g3_e1_pilot_5();
  const track_ids = sample.tracks.map(function (t) {
    return t.track_id;
  });

  const prep = prepare_g3_e1_inputs(sample, { write: write });

  if (options.skip_infer) {
    throw new Error('skip_infer 不允許；缺 infer 須 fail-closed');
  }

  const infer = run_g3_e1_infer(sample, prep.manifest, { write: write });
  const validate_report = validate_g3_e1_inferences(infer.inferences, track_ids);
  const audit = audit_g3_e1_run(infer.run_manifest, validate_report);
  const comparison = compare_d1_d34_e1(infer.inferences, track_ids);
  const continuation = build_g3_e1_continuation_plan();

  let adopt_disabled = true;
  if (fs.existsSync(FILE_G3_D4_ADOPT_OVERLAY)) {
    const ov = JSON.parse(fs.readFileSync(FILE_G3_D4_ADOPT_OVERLAY, 'utf8'));
    adopt_disabled = ov.enabled !== true;
  }

  const summary = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    pilot_track_count: 5,
    stages_completed: ['prepare', 'infer', 'validate', 'audit', 'stage'],
    adopt_executed: false,
    adopt_overlay_disabled: adopt_disabled,
    validate_ok: validate_report.validate_ok,
    provenance_unverified: true,
    comparison_track_count: comparison.track_count,
  };

  if (write) {
    fs.mkdirSync(G3_E1_DIR, { recursive: true });
    write_json_atomic(FILE_G3_E1_FLOW_ANALYSIS, flow);
    write_json_atomic(FILE_G3_E1_SAMPLE_5, sample);
    write_json_atomic(FILE_G3_E1_INPUT_MANIFEST, prep.manifest);
    write_json_atomic(FILE_G3_E1_INFER_MANIFEST, infer.run_manifest);
    write_json_atomic(FILE_G3_E1_VALIDATE_REPORT, validate_report);
    write_json_atomic(FILE_G3_E1_AUDIT_REPORT, audit);
    write_json_atomic(FILE_G3_E1_COMPARISON, comparison);
    write_json_atomic(FILE_G3_E1_CONTINUATION_PLAN, continuation);
    write_json_atomic(FILE_G3_E1_OFFLINE_SUMMARY, summary);
  }

  return {
    summary: summary,
    flow: flow,
    sample: sample,
    infer: infer,
    validate_report: validate_report,
    audit: audit,
    comparison: comparison,
    continuation: continuation,
  };
}
