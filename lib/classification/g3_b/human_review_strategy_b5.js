/**
 * G3-B.5 人工複核風險分級（不要求逐首接受 AI）
 */
import { G1_MUST_INCLUDE_LEMON_TREE } from '../../enrichment/external/g1_sample.js';

export const RISK_TIER_PREVIEW = 'preview_ok';
export const RISK_TIER_EVIDENCE = 'needs_supplemental_evidence';
export const RISK_TIER_CONFLICT = 'classification_conflict';
export const RISK_TIER_HUMAN = 'requires_human_decision';

/**
 * @param {object} row unified plan track row
 */
export function assign_risk_tier(row) {
  const r = row || {};
  if (r.human_locked) {
    return {
      tier: RISK_TIER_HUMAN,
      reason_zh: '人工確認鎖定；AI 僅供對照',
    };
  }
  if (r.track_id === G1_MUST_INCLUDE_LEMON_TREE) {
    return {
      tier: RISK_TIER_HUMAN,
      reason_zh: '保留 G3-B.1 英文建議與 G3-B.2 衝突；fixture 國語非 MusicBrainz 查證',
    };
  }
  if (r.classification_gaps && r.classification_gaps.indexOf('language_unconfirmed') >= 0) {
    return {
      tier: RISK_TIER_EVIDENCE,
      reason_zh: '演唱語言未確認；不得以歌名腳本或 AI 推測當定案',
    };
  }
  if (r.vocal_hint && r.vocal_hint.indexOf('instrumental') === 0) {
    return {
      tier: RISK_TIER_EVIDENCE,
      reason_zh: '器樂／無人聲線索；需與「語言未知」區分',
    };
  }
  if (r.reuse && r.reuse.regen_reason === 'evidence_fingerprint_changed') {
    return {
      tier: RISK_TIER_CONFLICT,
      reason_zh: '證據指紋已變；既有 AI 可能過期',
    };
  }
  if (r.reuse && r.reuse.best_record && r.reuse.best_record.review_status === 'conflict') {
    return {
      tier: RISK_TIER_CONFLICT,
      reason_zh: '自動複核標記衝突',
    };
  }
  if (r.cohort === 'g3_b4_complete' && r.reuse && r.reuse.reusable) {
    return {
      tier: RISK_TIER_PREVIEW,
      reason_zh: 'G3-B.4 已完成 AI；可本機歌單預覽',
    };
  }
  if (r.needs_new_generation) {
    return {
      tier: RISK_TIER_EVIDENCE,
      reason_zh: '尚無可重用 AI；待生成後再複核',
    };
  }
  if (r.reuse && r.reuse.reusable) {
    return {
      tier: RISK_TIER_PREVIEW,
      reason_zh: '有可重用 AI 且主曲風缺口已覆蓋',
    };
  }
  return {
    tier: RISK_TIER_EVIDENCE,
    reason_zh: '需補證據或待 AI 生成',
  };
}

export function build_quality_check_sampling_plan(total_n) {
  const n = total_n || 100;
  const sample_size = n >= 100 ? 15 : Math.max(10, Math.floor(n * 0.15));
  return {
    schema_version: 1,
    method_zh:
      '固定 seed 分層抽 15 首（含各風險 tier 至少 2 首）做人工 spot-check；比對 AI 自評信心與規則缺口，不要求全庫逐首聽歌。',
    suggested_sample_size: sample_size,
    strata: [
      { tier: RISK_TIER_PREVIEW, min_count: 4 },
      { tier: RISK_TIER_EVIDENCE, min_count: 4 },
      { tier: RISK_TIER_CONFLICT, min_count: 2 },
      { tier: RISK_TIER_HUMAN, min_count: 2 },
    ],
    ai_confidence_vs_accuracy_zh:
      'AI confidence_tier 僅為自評；準確率須以 spot-check 與人工確認 ground truth 估算，不得外推至 7759 首。',
    phase_note_zh: 'G3-B.5 僅輸出計畫；實際聽歌複核留待 G3-B.6 執行後。',
  };
}
