/**
 * G2 查證可信度分層（分數 ≠ 準確率）
 */
import {
  ARTIST_MATCH_STATUS,
  artist_overlap_metrics,
  merge_local_artist_names,
} from './artist_evidence.js';

export const MATCH_TIER = {
  isrc_direct: 'isrc_direct',
  cross_match: 'cross_match',
  text_weak: 'text_weak',
  ambiguous: 'ambiguous',
  none: 'none',
};

export const MATCH_TIER_LABEL_ZH = {
  isrc_direct: 'ISRC 錄音識別碼直配',
  cross_match: '歌名＋藝人＋曲長交叉比對',
  text_weak: '僅文字相似之候選',
  ambiguous: '存在版本歧義',
  none: '無可靠比對',
};

function title_token_ratio(a, b) {
  const ta = String(a || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const tb = String(b || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!ta.length || !tb.length) {
    return 0;
  }
  const set_b = {};
  for (let i = 0; i < tb.length; i += 1) {
    set_b[tb[i]] = true;
  }
  let inter = 0;
  for (let j = 0; j < ta.length; j += 1) {
    if (set_b[ta[j]]) {
      inter += 1;
    }
  }
  return inter / Math.max(ta.length, tb.length);
}

/**
 * G2.1：ISRC 命中時的藝人／歌名證據（與評分共用 local+extra 藝人集合）
 * @param {object} params
 */
export function evaluate_isrc_artist_evidence(params) {
  const p = params || {};
  const input = p.input;
  const best = p.best;
  const extra = p.extra_artist_names || [];
  const isrc_candidate_count =
    typeof p.isrc_candidate_count === 'number' ? p.isrc_candidate_count : 1;

  /** @type {string[]} */
  const evidence_sources = p.evidence_sources ? p.evidence_sources.slice() : [];

  if (!best || !input) {
    return {
      isrc_conflict: false,
      artist_match_status: null,
      conflict_reasons: [],
      artist_evidence_sources: evidence_sources,
    };
  }

  const title_r = title_token_ratio(input.title, best.title);
  const locals = merge_local_artist_names(input, extra);
  const ext = best.artist_names || [];
  const overlap = artist_overlap_metrics(locals, ext);

  /** @type {string[]} */
  const conflict_reasons = [];

  if (title_r < 0.45) {
    conflict_reasons.push('歌名 token 相似度低於 0.45');
    return {
      isrc_conflict: true,
      artist_match_status: ARTIST_MATCH_STATUS.mismatch,
      conflict_reasons: conflict_reasons,
      artist_evidence_sources: evidence_sources,
      title_token_ratio: title_r,
      artist_best_ratio: overlap.artist_best_ratio,
    };
  }

  if (overlap.artist_best_ratio >= 0.25) {
    return {
      isrc_conflict: false,
      artist_match_status: ARTIST_MATCH_STATUS.verified,
      conflict_reasons: [],
      artist_evidence_sources: evidence_sources,
      title_token_ratio: title_r,
      artist_best_ratio: overlap.artist_best_ratio,
    };
  }

  if (overlap.cross_script_only && title_r >= 0.85 && isrc_candidate_count >= 1) {
    if (extra.length) {
      evidence_sources.push('artist_name_variants');
    }
    evidence_sources.push('isrc_single_recording');
    return {
      isrc_conflict: false,
      artist_match_status: ARTIST_MATCH_STATUS.unverified_cross_script,
      conflict_reasons: [],
      artist_evidence_sources: evidence_sources,
      title_token_ratio: title_r,
      artist_best_ratio: overlap.artist_best_ratio,
    };
  }

  conflict_reasons.push(
    '同書寫系統下藝人字串相似度不足（非僅跨語系所致）'
  );
  return {
    isrc_conflict: true,
    artist_match_status: ARTIST_MATCH_STATUS.mismatch,
    conflict_reasons: conflict_reasons,
    artist_evidence_sources: evidence_sources,
    title_token_ratio: title_r,
    artist_best_ratio: overlap.artist_best_ratio,
  };
}

/**
 * @deprecated 使用 evaluate_isrc_artist_evidence
 */
export function detect_isrc_conflict(input, best, artist_best_ratio) {
  const ev = evaluate_isrc_artist_evidence({
    input: input,
    best: best,
    extra_artist_names: [],
    isrc_candidate_count: 1,
  });
  if (ev.isrc_conflict) {
    return true;
  }
  if (
    typeof artist_best_ratio === 'number' &&
    artist_best_ratio < 0.25 &&
    !ev.artist_match_status
  ) {
    return true;
  }
  return ev.isrc_conflict;
}

/**
 * @param {object} params
 */
export function resolve_match_tier(params) {
  const p = params || {};
  if (p.version_ambiguous) {
    return {
      match_tier: MATCH_TIER.ambiguous,
      match_tier_note: MATCH_TIER_LABEL_ZH.ambiguous,
    };
  }
  if (!p.best_match) {
    return {
      match_tier: MATCH_TIER.none,
      match_tier_note: MATCH_TIER_LABEL_ZH.none,
    };
  }
  if (p.isrc_conflict) {
    return {
      match_tier: MATCH_TIER.text_weak,
      match_tier_note: 'ISRC 有回應但歌名或藝人與本機列明顯不符，降為文字弱候選',
    };
  }
  if (p.isrc_used && p.verify_status === 'matched') {
    if (p.artist_match_status === ARTIST_MATCH_STATUS.unverified_cross_script) {
      return {
        match_tier: MATCH_TIER.isrc_direct,
        match_tier_note:
          'ISRC 錄音直配；藝人名稱跨語系尚未核實（未宣稱文字一致）',
      };
    }
    return {
      match_tier: MATCH_TIER.isrc_direct,
      match_tier_note: MATCH_TIER_LABEL_ZH.isrc_direct,
    };
  }
  if (p.verify_status === 'matched' && !p.isrc_used) {
    return {
      match_tier: MATCH_TIER.cross_match,
      match_tier_note: MATCH_TIER_LABEL_ZH.cross_match,
    };
  }
  if (p.verify_status === 'insufficient' || p.verify_status === 'candidates_found') {
    return {
      match_tier: MATCH_TIER.text_weak,
      match_tier_note: MATCH_TIER_LABEL_ZH.text_weak,
    };
  }
  return {
    match_tier: MATCH_TIER.none,
    match_tier_note: MATCH_TIER_LABEL_ZH.none,
  };
}
