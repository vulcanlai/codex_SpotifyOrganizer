/**
 * G3-B.2 離線自動複核（無 AI API）
 */
import { SUBGENRES_BY_CODE } from '../genre_taxonomy.js';
import { CONFIDENCE_CONFIRMED } from '../dimensions.js';
import {
  detect_title_only_language_risk,
  get_known_vocal_language_fixture,
  mb_provides_vocal_language,
} from './language_evidence.js';
import { has_primary_genre_gap } from './queue_state.js';

export const REVIEW_PASS = 'pass';
export const REVIEW_NEEDS_EVIDENCE = 'needs_evidence';
export const REVIEW_CONFLICT = 'conflict';
export const REVIEW_UNCONFIRMED = 'unconfirmed';

/**
 * @param {object} evidence_doc
 * @param {object} rule_draft
 * @param {object|null} ai_row G3-B AI 草稿列
 */
export function auto_review_ai_draft_row(evidence_doc, rule_draft, ai_row) {
  if (!ai_row) {
    return {
      status: REVIEW_UNCONFIRMED,
      issues: ['無 AI 草稿列'],
      needs_human_decision: false,
    };
  }

  /** @type {string[]} */
  const issues = [];
  let status = REVIEW_PASS;

  function bump(next) {
    if (status === REVIEW_PASS) {
      status = next;
    } else if (status === REVIEW_NEEDS_EVIDENCE && next === REVIEW_CONFLICT) {
      status = REVIEW_CONFLICT;
    }
  }

  if (evidence_doc.human_confirmation && evidence_doc.human_confirmation.locked) {
    bump(REVIEW_CONFLICT);
    issues.push('忽略人工鎖定曲目卻輸出 AI 覆寫性分類');
  }

  if (ai_row.confidence === CONFIDENCE_CONFIRMED) {
    bump(REVIEW_CONFLICT);
    issues.push('AI 草稿使用 confirmed');
  }

  if (ai_row.genre_profile && ai_row.genre_profile.confidence === CONFIDENCE_CONFIRMED) {
    bump(REVIEW_CONFLICT);
    issues.push('主曲風標為 confirmed');
  }

  const gp = ai_row.genre_profile || {};
  const subs = gp.subgenres || [];
  for (let i = 0; i < subs.length; i += 1) {
    const code = subs[i];
    if (!SUBGENRES_BY_CODE[code]) {
      bump(REVIEW_CONFLICT);
      issues.push('非法子曲風：' + code);
    } else if (gp.primary_genre && SUBGENRES_BY_CODE[code].main !== gp.primary_genre) {
      bump(REVIEW_CONFLICT);
      issues.push('子曲風與主曲風不符：' + code);
    }
  }

  if (ai_row.language) {
    const risk = detect_title_only_language_risk(evidence_doc, ai_row.language);
    if (risk.risky) {
      bump(REVIEW_NEEDS_EVIDENCE);
      issues.push.apply(issues, risk.reasons);
    }
    if (
      !mb_provides_vocal_language(evidence_doc) &&
      ai_row.language.value !== '未確認' &&
      ai_row.language.vocal_verification_status !== 'human_known_fixture' &&
      !ai_row.language.does_not_claim_mb_verification
    ) {
      if (!ai_row.language.vocal_verification_status) {
        bump(REVIEW_NEEDS_EVIDENCE);
        issues.push('演唱語言未標 vocal_verification_status=unverified');
      }
    }
  }

  const fixture = get_known_vocal_language_fixture(evidence_doc.track_id);
  if (fixture && ai_row.language && ai_row.language.value !== fixture.vocal_language) {
    bump(REVIEW_CONFLICT);
    issues.push(
      '與專案已知演唱語言 fixture 不符（fixture=' +
        fixture.vocal_language +
        '，草稿=' +
        ai_row.language.value +
        '；非 MB 查證）'
    );
  }

  if (ai_row.version_uncertainty !== true) {
    const title = evidence_doc.identity && evidence_doc.identity.title;
    if (title && /live|remix|版|Version/i.test(title)) {
      bump(REVIEW_NEEDS_EVIDENCE);
      issues.push('標題暗示版本歧義但未標 version_uncertainty');
    }
  }

  const pr = evidence_doc.priority_resolution || {};
  if (
    has_primary_genre_gap(rule_draft) &&
    gp.primary_genre &&
    gp.primary_genre !== 'unknown' &&
    pr.effective_for_classification === 'external_facts_g2_1' &&
    !has_unverified_mb(evidence_doc)
  ) {
    /* 有 MB 推論時 AI 填主曲風可接受 */
  }

  if (
    ai_row.language &&
    ai_row.language.evidence &&
    /musicbrainz|MB 查證|已核實事實/i.test(ai_row.language.evidence)
  ) {
    bump(REVIEW_CONFLICT);
    issues.push('將 AI 語言推測表述為 MusicBrainz 查證');
  }

  const needs_human_decision =
    status === REVIEW_CONFLICT ||
    (status === REVIEW_CONFLICT && fixture != null);

  return {
    status: status,
    issues: issues,
    needs_human_decision: status === REVIEW_CONFLICT,
    needs_supplemental_evidence: status === REVIEW_NEEDS_EVIDENCE,
  };
}

function has_unverified_mb(evidence_doc) {
  const v = evidence_doc.verification_status || {};
  const layers = [v.g2_1_offline, v.g2, v.g1];
  for (let i = 0; i < layers.length; i += 1) {
    if (layers[i] && layers[i].pending_verification) {
      return true;
    }
  }
  return false;
}

/**
 * @param {object[]} rows
 * @param {Record<string, object>} evidence_by_id
 * @param {Record<string, object>} rule_by_id
 */
export function auto_review_ai_draft_batch(rows, evidence_by_id, rule_by_id) {
  const results = [];
  const counts = {
    pass: 0,
    needs_evidence: 0,
    conflict: 0,
    unconfirmed: 0,
    needs_human_decision: 0,
    needs_supplemental_evidence: 0,
  };

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const ev = evidence_by_id[row.track_id];
    const rule = rule_by_id[row.track_id];
    const review = auto_review_ai_draft_row(ev, rule, row);
    results.push({
      track_id: row.track_id,
      title: row.title,
      review: review,
    });
    if (counts[review.status] != null) {
      counts[review.status] += 1;
    }
    if (review.needs_human_decision) {
      counts.needs_human_decision += 1;
    }
    if (review.needs_supplemental_evidence) {
      counts.needs_supplemental_evidence += 1;
    }
  }

  return { results: results, counts: counts };
}
