/**
 * G3-D.5 採用前驗收主流程
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { audit_agent_provenance_200 } from './g3_d5_provenance.js';
import { select_spot_check_40 } from './g3_d5_spot_sample.js';
import { build_spot_check_40_report } from './g3_d5_spot_check.js';
import { analyze_needs_evidence_200 } from './g3_d5_needs_evidence.js';
import { classify_eligibility_abcd_200 } from './g3_d5_eligibility.js';
import { run_adopt_dry_run } from './g3_d5_adopt_dry_run.js';
import { reconcile_d1_d3_d4 } from './g3_d4_reconcile.js';
import {
  G3_D5_DIR,
  FILE_G3_D5_PROVENANCE,
  FILE_G3_D5_SPOT_40,
  FILE_G3_D5_NEEDS_EVIDENCE,
  FILE_G3_D5_ELIGIBILITY,
  FILE_G3_D5_ELIGIBILITY_POLICY,
  FILE_G3_D5_ADOPT_DRY_RUN,
  FILE_G3_D5_RISKS,
  FILE_G3_D5_RECOMMENDATION,
  FILE_G3_D5_OFFLINE_SUMMARY,
} from './paths_d5.js';

/**
 * @param {{ write?: boolean, project_root?: string }} [opts]
 */
export function run_g3_d5(opts) {
  const options = opts || {};
  const write = options.write !== false;
  const root = options.project_root || process.cwd();

  const reconcile = reconcile_d1_d3_d4();
  const provenance = audit_agent_provenance_200(root);
  const prov_by = {};
  for (let i = 0; i < provenance.tracks.length; i += 1) {
    prov_by[provenance.tracks[i].track_id] = provenance.tracks[i];
  }

  let sample = select_spot_check_40(reconcile.d1_track_ids);
  if (sample.tracks.length > 40) {
    sample.tracks = sample.tracks.slice(0, 40);
    sample.actual = 40;
  }

  const spot = build_spot_check_40_report(sample, prov_by);
  const needs_ev = analyze_needs_evidence_200();
  const eligibility = classify_eligibility_abcd_200(provenance.tracks);
  write_json_atomic(FILE_G3_D5_ELIGIBILITY_POLICY, eligibility.policy);

  const dry_run = run_adopt_dry_run({
    A_ids: eligibility.lists.A,
    B_ids: eligibility.lists.B,
  });

  const risks = {
    schema_version: 1,
    items_zh: [
      '140 首 batch 04–17 為 build_batches_04_17.mjs 產出，provenance_unverified',
      '全 200 首無 Cursor session log，僅 attested 模組／JSON',
      needs_ev.needs_evidence_track_count + ' 首 v2 needs_evidence',
      eligibility.counts.C + ' 首暫緩採用（C 類）',
      '154 needs_evidence 與欄位任務重疊計數見 needs-evidence-breakdown.json',
    ],
    provenance_unverified_count: provenance.summary.provenance_unverified,
    duplicate_reason_groups: provenance.duplicate_reason_groups.length,
  };

  const recommend_enable =
    eligibility.counts.A >= 40 &&
    provenance.summary.provenance_unverified === 0 &&
    needs_ev.needs_evidence_track_count < 50;

  const recommendation = {
    schema_version: 1,
    recommend_enable_adopt: false,
    rationale_zh: recommend_enable
      ? '條件看似足夠，但仍缺 session 證明，維持 false'
      : '140 首來源未驗證 + needs_evidence 仍高；僅建議 A/B dry-run 後人工 spot-check',
    conditions_before_enable_zh: [
      '使用者審閱 spot-check-40 與 eligibility C/D 清單',
      '決定是否重跑 batch 04–17 為可追溯 Agent 草稿',
      'npm test 全過',
      '顯式將 adopt-overlay-draft.json enabled 設 true（非本階段）',
    ],
    dry_run_passed: dry_run.rollback_test.pass && dry_run.overlay_file_enabled === true,
  };

  const summary = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    track_count: 200,
    provenance: provenance.summary,
    spot_verdict_counts: spot.verdict_counts,
    needs_evidence_track_count: needs_ev.needs_evidence_track_count,
    needs_evidence_field_task_count: needs_ev.field_task_count,
    eligibility_counts: eligibility.counts,
    dry_run: {
      balanced_delta: dry_run.playlist.balanced_delta,
      relaxed_delta: dry_run.playlist.relaxed_delta,
      adopt_ab_count: dry_run.adopt_id_count,
    },
    recommend_enable_adopt: recommendation.recommend_enable_adopt,
  };

  if (write) {
    fs.mkdirSync(G3_D5_DIR, { recursive: true });
    write_json_atomic(FILE_G3_D5_PROVENANCE, provenance);
    write_json_atomic(FILE_G3_D5_SPOT_40, spot);
    write_json_atomic(FILE_G3_D5_NEEDS_EVIDENCE, needs_ev);
    write_json_atomic(FILE_G3_D5_ELIGIBILITY, eligibility);
    write_json_atomic(FILE_G3_D5_ADOPT_DRY_RUN, dry_run);
    write_json_atomic(FILE_G3_D5_RISKS, risks);
    write_json_atomic(FILE_G3_D5_RECOMMENDATION, recommendation);
    write_json_atomic(FILE_G3_D5_OFFLINE_SUMMARY, summary);
  }

  return {
    summary: summary,
    provenance: provenance,
    spot: spot,
    needs_ev: needs_ev,
    eligibility: eligibility,
    dry_run: dry_run,
    recommendation: recommendation,
  };
}
