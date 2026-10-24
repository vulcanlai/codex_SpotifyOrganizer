/**
 * 可信度分級（規則推導，非 AI 自稱 confidence）
 */
import { GENRE_PRIMARY_UNKNOWN } from './genre_taxonomy.js';
import { genre_profile_from_ai_candidate } from './genre_profile.js';

export const TIER_HIGH = 'high';
export const TIER_MEDIUM = 'medium';
export const TIER_LOW = 'low';

export const TIER_VALUES = [TIER_HIGH, TIER_MEDIUM, TIER_LOW];

const MIN_EVIDENCE_HIGH = 25;
const MIN_EVIDENCE_MEDIUM = 12;

function tag_evidence_len(tag) {
  if (!tag || typeof tag.evidence !== 'string') {
    return 0;
  }
  return tag.evidence.trim().length;
}

function count_inferred_dimensions(candidate) {
  let n = 0;
  if (candidate.language && candidate.language.confidence === 'inferred') {
    n += 1;
  }
  const gp = candidate.genre_profile;
  if (gp && gp.primary_genre && typeof gp.primary_genre === 'object') {
    if (gp.primary_genre.confidence === 'inferred') {
      n += 1;
    }
  }
  const ctx = candidate.contexts || candidate.moods || [];
  for (let i = 0; i < ctx.length; i += 1) {
    if (ctx[i].confidence === 'inferred') {
      n += 1;
    }
  }
  return n;
}

/**
 * 主曲風 evidence 是否錨定本曲歌名或專輯（避免僅藝人定位 + 長文字即 high）
 * @param {string} evidence
 * @param {object} index_row
 */
export function primary_evidence_anchors_track(evidence, index_row) {
  if (!evidence || typeof evidence !== 'string' || !index_row) {
    return false;
  }
  const e = evidence.trim();
  if (!e) {
    return false;
  }
  const display = index_row.display || {};
  const merged = index_row.merged_metadata || {};
  const title = (display.name || merged.name || '').trim();
  const album = (display.album_name || merged.album_name || '').trim();
  if (title && title.length >= 2 && e.indexOf(title) >= 0) {
    return true;
  }
  if (album && album.length >= 3 && e.indexOf(album) >= 0) {
    return true;
  }
  return false;
}

/**
 * @param {object} ctx { candidate, index_row }
 */
export function compute_confidence_tier(ctx) {
  const candidate = ctx.candidate || null;
  const index_row = ctx.index_row || null;
  const reasons = [];

  if (!candidate) {
    return { tier: TIER_LOW, reasons: ['無 AI 候選資料'] };
  }

  const gp = genre_profile_from_ai_candidate(candidate);
  if (gp.primary_genre === GENRE_PRIMARY_UNKNOWN) {
    return { tier: TIER_LOW, reasons: ['主曲風為未確認，證據不足'] };
  }

  const prim_tag =
    candidate.genre_profile && candidate.genre_profile.primary_genre
      ? candidate.genre_profile.primary_genre
      : null;

  if (!prim_tag || prim_tag.confidence === 'unknown') {
    return { tier: TIER_LOW, reasons: ['主曲風 AI 標記為 unknown'] };
  }

  const ev_len = tag_evidence_len(prim_tag);
  if (ev_len < MIN_EVIDENCE_MEDIUM) {
    return {
      tier: TIER_LOW,
      reasons: ['主曲風 evidence 過短（<' + MIN_EVIDENCE_MEDIUM + ' 字）'],
    };
  }

  if (index_row && index_row.metadata_status !== 'complete') {
    reasons.push('歌曲 metadata 未完整，上限 medium');
    return { tier: TIER_MEDIUM, reasons };
  }

  const lang = candidate.language;
  if (!lang || lang.value === '未確認' || lang.confidence === 'unknown') {
    reasons.push('語言未確認，上限 medium');
    return { tier: TIER_MEDIUM, reasons };
  }

  const inferred_dims = count_inferred_dimensions(candidate);
  if (ev_len >= MIN_EVIDENCE_HIGH && inferred_dims >= 2 && lang.confidence === 'inferred') {
    if (!primary_evidence_anchors_track(prim_tag.evidence, index_row)) {
      return {
        tier: TIER_MEDIUM,
        reasons: [
          '主曲風 evidence 未錨定本曲歌名或專輯，僅藝人／類型推論上限 medium',
        ],
      };
    }
    return {
      tier: TIER_HIGH,
      reasons: ['主曲風 evidence 錨定曲目／專輯且多維度可追溯 inferred 標籤'],
    };
  }

  if (ev_len >= MIN_EVIDENCE_MEDIUM) {
    return {
      tier: TIER_MEDIUM,
      reasons: ['有部分可追溯 evidence，建議抽樣或人工確認'],
    };
  }

  return { tier: TIER_LOW, reasons: ['綜合證據不足'] };
}
