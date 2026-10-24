/**
 * G3-D.5 採用資格 A/B/C/D（政策分組，非正式確認）
 */
import fs from 'node:fs';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import {
  auto_review_ai_draft_with_quality,
  QUALITY_OK,
  QUALITY_NEEDS_EVIDENCE,
  QUALITY_CONFLICT,
} from './auto_review_quality.js';
import { resolve_human_confirmation } from '../g3_evidence/human_confirmation.js';
import { load_g3_source_bundle } from '../g3_evidence/source_loaders.js';
import { FILE_CLASSIFICATION_INDEX } from '../paths.js';
import { FILE_G3_D4_MERGED_CANDIDATE_200 } from './paths_d4.js';
import { classify_needs_evidence_buckets, NE_BUCKET_PRIMARY, NE_BUCKET_HUMAN } from './g3_d5_needs_evidence.js';
import { REVIEW_CONFLICT } from '../g3_b/auto_review.js';

export const ELIG_A = 'A_auto_adopt_ai_suggestion';
export const ELIG_B = 'B_adopt_with_evidence_gaps';
export const ELIG_C = 'C_defer_adopt';
export const ELIG_D = 'D_needs_human_decision';

export function build_adopt_eligibility_policy() {
  return {
    schema_version: 1,
    enabled: false,
    rules_zh: [
      '人工確認不可覆寫（human_locked → D，不進 A/B dry-run）',
      '外部 verified_evidence 優先於 adopt 候選（本波未改寫 evidence 列）',
      'auto_review conflict → D',
      'provenance_unverified 不得進 A（最多 B 或 C）',
      '結構／字典驗證已於 D.3/D.4 匯入前完成',
      'low/unknown 不得標為 confirmed（維持 inferred）',
      'needs_evidence：僅 non_critical 欄位 → B；含 primary 不足 → C',
    ],
    tier_meanings_zh: {
      A: '可自動採用為 unified 之 AI 建議（仍非人工 confirmed）',
      B: '可採用但保留缺證據／unverified 狀態',
      C: '暫緩採用（來源未驗證且品質不足等）',
      D: '需人工決策或衝突',
    },
  };
}

/**
 * @param {object[]} provenance_tracks from audit
 */
export function classify_eligibility_abcd_200(provenance_tracks) {
  const merged = JSON.parse(fs.readFileSync(FILE_G3_D4_MERGED_CANDIDATE_200, 'utf8'));
  const index_doc = JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8'));
  const tracks_by_id = index_doc.tracks_by_id || {};
  const bundle = load_g3_source_bundle();
  const ev_all = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};

  const prov_by = {};
  for (let p = 0; p < provenance_tracks.length; p += 1) {
    prov_by[provenance_tracks[p].track_id] = provenance_tracks[p];
  }

  const lists = { A: [], B: [], C: [], D: [] };
  /** @type {object[]} */
  const per_track = [];

  for (let i = 0; i < merged.tracks.length; i += 1) {
    const row = merged.tracks[i];
    const id = row.track_id;
    const ev = ev_all[id];
    const rule = ev ? rule_classify_track(ev) : {};
    const review = auto_review_ai_draft_with_quality(ev, rule, row);
    const prov = prov_by[id];
    const human = resolve_human_confirmation(id, {
      index_row: tracks_by_id[id],
      overrides_doc: bundle.manual_overrides,
      v2_review: bundle.ai_review_by_id[id] ? bundle.ai_review_by_id[id].review : null,
    });

    let tier = ELIG_C;
    const reasons = [];

    if (human.locked) {
      tier = ELIG_D;
      reasons.push('human_locked');
    } else if (review.status === REVIEW_CONFLICT || review.quality_status === QUALITY_CONFLICT) {
      tier = ELIG_D;
      reasons.push('review_conflict');
    } else if (review.needs_human_decision) {
      tier = ELIG_D;
      reasons.push('needs_human_decision');
    } else if (prov && prov.provenance_status === 'provenance_unverified') {
      if (review.quality_status === QUALITY_OK) {
        tier = ELIG_B;
        reasons.push('provenance_unverified_quality_ok');
      } else {
        tier = ELIG_C;
        reasons.push('provenance_unverified');
      }
    } else if (review.quality_status === QUALITY_OK) {
      tier = ELIG_A;
      reasons.push('quality_ok_attested_module');
    } else if (review.quality_status === QUALITY_NEEDS_EVIDENCE) {
      const buckets = classify_needs_evidence_buckets(row, ev, review);
      const has_primary = buckets.track_buckets.indexOf(NE_BUCKET_PRIMARY) >= 0;
      const only_non_critical =
        buckets.track_buckets.length > 0 &&
        !has_primary &&
        buckets.track_buckets.indexOf(NE_BUCKET_HUMAN) < 0;
      if (only_non_critical) {
        tier = ELIG_B;
        reasons.push('needs_evidence_non_critical_only');
      } else {
        tier = ELIG_C;
        reasons.push('needs_evidence_primary_or_multi');
      }
    } else {
      tier = ELIG_C;
      reasons.push('other_quality_state');
    }

    const key =
      tier === ELIG_A
        ? 'A'
        : tier === ELIG_B
          ? 'B'
          : tier === ELIG_C
            ? 'C'
            : 'D';
    lists[key].push(id);

    per_track.push({
      track_id: id,
      title: row.title,
      eligibility: tier,
      reasons: reasons,
      quality_status: review.quality_status,
      provenance_status: prov ? prov.provenance_status : null,
      human_locked: human.locked,
    });
  }

  return {
    schema_version: 1,
    counts: {
      A: lists.A.length,
      B: lists.B.length,
      C: lists.C.length,
      D: lists.D.length,
      total: merged.tracks.length,
    },
    lists: lists,
    per_track: per_track,
    policy: build_adopt_eligibility_policy(),
  };
}
