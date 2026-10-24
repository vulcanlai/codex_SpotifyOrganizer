/**
 * G3-D.2 自動複核：結構（v1）+ 分類品質（v2）
 * v1 邏輯不變；v2 不重寫 G3-D.1 草稿，僅衍生 overlay。
 */
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import {
  auto_review_ai_draft_row,
  REVIEW_PASS,
  REVIEW_NEEDS_EVIDENCE,
  REVIEW_CONFLICT,
  REVIEW_UNCONFIRMED,
} from '../g3_b/auto_review.js';

export const QUALITY_OK = 'quality_ok';
export const QUALITY_CLASSIFICATION_UNKNOWN = 'classification_unknown';
export const QUALITY_NEEDS_EVIDENCE = 'needs_evidence';
export const QUALITY_CONFLICT = 'conflict';
export const QUALITY_NEEDS_HUMAN = 'needs_human_decision';

export const STRUCTURAL_PASS = 'structural_pass';

/**
 * @param {object} structural_review auto_review_ai_draft_row 結果
 * @param {object} evidence_doc
 * @param {object} rule_draft
 * @param {object} ai_row
 */
export function derive_quality_review(structural_review, evidence_doc, rule_draft, ai_row) {
  const issues = (structural_review.issues || []).slice();
  let quality_status = QUALITY_OK;

  if (!ai_row) {
    return {
      structural_status: structural_review.status,
      quality_status: QUALITY_CLASSIFICATION_UNKNOWN,
      issues: issues.concat(['無 AI 列']),
      structural_pass: false,
    };
  }

  if (structural_review.status === REVIEW_CONFLICT) {
    quality_status = QUALITY_NEEDS_HUMAN;
  } else if (structural_review.status === REVIEW_NEEDS_EVIDENCE) {
    quality_status = QUALITY_NEEDS_EVIDENCE;
  } else if (structural_review.status === REVIEW_UNCONFIRMED) {
    quality_status = QUALITY_CLASSIFICATION_UNKNOWN;
  }

  const gp = ai_row.genre_profile || {};
  const primary = gp.primary_genre || GENRE_PRIMARY_UNKNOWN;
  const tier = ai_row.confidence_tier || 'unknown';

  if (primary === GENRE_PRIMARY_UNKNOWN) {
    if (quality_status === QUALITY_OK) {
      quality_status = QUALITY_CLASSIFICATION_UNKNOWN;
    }
    issues.push('主曲風仍 unknown（非結構錯誤，屬分類品質未決）');
  }

  if (tier === 'low' && quality_status === QUALITY_OK) {
    quality_status = QUALITY_NEEDS_EVIDENCE;
    issues.push('AI confidence_tier=low，不宜視為分類品質可接受');
  }

  const reason = String(ai_row.reason_zh || '');
  if (
    reason === 'metadata／候選不足；保留 unknown 與未確認' &&
    primary === GENRE_PRIMARY_UNKNOWN
  ) {
    issues.push('保守 fallback 理由（D.1 推理層預設句）');
  }

  const specs = ai_row.special_types || [];
  let has_instrumental_tag = false;
  for (let s = 0; s < specs.length; s += 1) {
    const v = specs[s].value || specs[s];
    if (v === '純音樂') {
      has_instrumental_tag = true;
    }
  }
  if (
    has_instrumental_tag &&
    primary !== 'soundtrack_instrumental' &&
    primary !== 'classical' &&
    quality_status === QUALITY_OK
  ) {
    quality_status = QUALITY_NEEDS_EVIDENCE;
    issues.push('標記純音樂但主曲風非配樂／古典');
  }

  if (
    primary === 'soundtrack_instrumental' &&
    !has_instrumental_tag &&
    !(ai_row.language && ai_row.language.value === '未確認')
  ) {
    issues.push('主曲風配樂但未標純音樂／語言未確認（可能含人聲配樂）');
    if (quality_status === QUALITY_OK) {
      quality_status = QUALITY_NEEDS_EVIDENCE;
    }
  }

  const identity = evidence_doc.identity || {};
  const sparse =
    !identity.enrichment_cache_complete &&
    !identity.isrc &&
    !identity.album_name;
  if (
    sparse &&
    primary !== GENRE_PRIMARY_UNKNOWN &&
    tier !== 'high' &&
    quality_status === QUALITY_OK
  ) {
    quality_status = QUALITY_NEEDS_EVIDENCE;
    issues.push('metadata 稀疏卻給定具體主曲風');
  }

  const structural_pass =
    structural_review.status === REVIEW_PASS ||
    structural_review.status === REVIEW_NEEDS_EVIDENCE;

  return {
    structural_status: structural_review.status,
    structural_pass: structural_pass,
    quality_status: quality_status,
    issues: issues,
    needs_human_decision: quality_status === QUALITY_NEEDS_HUMAN,
    needs_supplemental_evidence:
      quality_status === QUALITY_NEEDS_EVIDENCE ||
      quality_status === QUALITY_CLASSIFICATION_UNKNOWN,
  };
}

/**
 * @param {object} evidence_doc
 * @param {object} rule_draft
 * @param {object|null} ai_row
 */
export function auto_review_ai_draft_with_quality(evidence_doc, rule_draft, ai_row) {
  const structural = auto_review_ai_draft_row(evidence_doc, rule_draft, ai_row);
  const quality = derive_quality_review(structural, evidence_doc, rule_draft, ai_row);
  return Object.assign({}, structural, {
    structural_status: quality.structural_status,
    structural_pass: quality.structural_pass,
    quality_status: quality.quality_status,
    quality_issues: quality.issues,
    issues: structural.issues,
    needs_human_decision: quality.needs_human_decision,
    needs_supplemental_evidence: quality.needs_supplemental_evidence,
  });
}

/**
 * @param {object[]} rows
 * @param {Record<string, object>} evidence_by_id
 * @param {Record<string, object>} rule_by_id
 */
export function auto_review_quality_batch(rows, evidence_by_id, rule_by_id) {
  const results = [];
  const v1_counts = {
    pass: 0,
    needs_evidence: 0,
    conflict: 0,
    unconfirmed: 0,
  };
  const v2_counts = {
    quality_ok: 0,
    classification_unknown: 0,
    needs_evidence: 0,
    conflict: 0,
    needs_human_decision: 0,
  };

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const ev = evidence_by_id[row.track_id];
    const rule = rule_by_id[row.track_id];
    const review = auto_review_ai_draft_with_quality(ev, rule, row);
    results.push({
      track_id: row.track_id,
      title: row.title,
      review_v1_status: review.status,
      review_v2: review,
    });
    if (v1_counts[review.status] != null) {
      v1_counts[review.status] += 1;
    }
    if (v2_counts[review.quality_status] != null) {
      v2_counts[review.quality_status] += 1;
    }
  }

  return { results: results, v1_counts: v1_counts, v2_counts: v2_counts };
}
