/**
 * 品質驗證 UI 用曲目摘要（不呼叫 Spotify API）
 */
import { compute_confidence_tier } from './confidence_tier.js';
import { genre_profile_from_ai_candidate } from './genre_profile.js';
import {
  main_genre_label_zh,
  subgenre_label_zh,
  GENRE_PRIMARY_UNKNOWN,
} from './genre_taxonomy.js';
import { decade_from_tags } from './ai_sample_select.js';
import { VERDICT_UNSET } from './quality_audit_paths.js';

function tag_list(tags) {
  const out = [];
  if (!tags) {
    return out;
  }
  for (let i = 0; i < tags.length; i += 1) {
    const t = tags[i];
    if (!t || !t.value) {
      continue;
    }
    out.push({
      value: t.value,
      confidence: t.confidence || 'unknown',
      evidence: t.evidence || '',
    });
  }
  return out;
}

function display_from_index(row) {
  if (!row) {
    return {
      name: '',
      artists: [],
      album_name: '',
      release_date: '',
    };
  }
  const d = row.display || {};
  const m = row.merged_metadata || {};
  return {
    name: d.name || m.name || '',
    artists: d.artists || m.artists || [],
    album_name: d.album_name || m.album_name || '',
    release_date: d.release_date || m.release_date || '',
  };
}

function uncertainty_hints(candidate, tier_result, index_row) {
  const hints = [];
  const gp = genre_profile_from_ai_candidate(candidate);
  const prim = candidate.genre_profile && candidate.genre_profile.primary_genre;
  const lang = candidate.language;

  if (gp.primary_genre === GENRE_PRIMARY_UNKNOWN) {
    hints.push('目前無法確認主曲風');
  } else if (prim && prim.confidence === 'unknown') {
    hints.push('主曲風依據不足，AI 標記為資料不足');
  }

  if (tier_result.tier === 'low' && gp.primary_genre !== GENRE_PRIMARY_UNKNOWN) {
    hints.push('系統評估為低可信度，建議人工聽音或補齊歌曲資訊');
  }

  if (index_row && index_row.metadata_status !== 'complete') {
    hints.push('本機歌曲基本資料尚未完整');
  }

  if (!lang || lang.value === '未確認' || lang.confidence === 'unknown') {
    hints.push('演唱語言尚未確認');
  }

  return hints;
}

/**
 * @param {object} params
 */
export function build_quality_audit_track_view(params) {
  const candidate = params.candidate;
  const index_row = params.index_row || null;
  const review = params.review || null;
  const disp = display_from_index(index_row);
  const gp = genre_profile_from_ai_candidate(candidate);
  const tier_result = compute_confidence_tier({
    candidate,
    index_row,
  });

  const secondary = [];
  const sec_tags =
    candidate.genre_profile && candidate.genre_profile.secondary_genres
      ? candidate.genre_profile.secondary_genres
      : [];
  for (let i = 0; i < sec_tags.length; i += 1) {
    if (sec_tags[i] && sec_tags[i].value) {
      secondary.push({
        code: sec_tags[i].value,
        label_zh: main_genre_label_zh(sec_tags[i].value),
        evidence: sec_tags[i].evidence || '',
      });
    }
  }

  const subgenres = [];
  const sub_tags =
    candidate.genre_profile && candidate.genre_profile.subgenres
      ? candidate.genre_profile.subgenres
      : [];
  for (let s = 0; s < sub_tags.length; s += 1) {
    if (sub_tags[s] && sub_tags[s].value) {
      subgenres.push({
        code: sub_tags[s].value,
        label_zh: subgenre_label_zh(sub_tags[s].value),
        evidence: sub_tags[s].evidence || '',
      });
    }
  }

  const prim = candidate.genre_profile && candidate.genre_profile.primary_genre;
  const id = candidate.spotify_id;
  const spotify_open_url =
    id && /^[A-Za-z0-9]{22}$/.test(id)
      ? 'https://open.spotify.com/track/' + id
      : null;

  return {
    spotify_id: id,
    display: disp,
    decade: decade_from_tags(index_row),
    metadata_status: index_row ? index_row.metadata_status : 'metadata_missing',
    ai: {
      primary_genre: {
        code: gp.primary_genre,
        label_zh: main_genre_label_zh(gp.primary_genre),
        confidence: prim ? prim.confidence : 'unknown',
        evidence: prim ? prim.evidence || '' : '',
      },
      secondary_genres: secondary,
      subgenres,
      language: candidate.language
        ? {
            value: candidate.language.value,
            confidence: candidate.language.confidence,
            evidence: candidate.language.evidence || '',
          }
        : null,
      contexts: tag_list(candidate.contexts || candidate.moods),
      special_types: tag_list(candidate.special_types),
      analysis_note: candidate.analysis_note || '',
    },
    confidence_tier: tier_result.tier,
    confidence_tier_reasons: tier_result.reasons,
    uncertainty_hints: uncertainty_hints(candidate, tier_result, index_row),
    spotify_open_url,
    quality_review: review
      ? {
          verdict: review.verdict,
          wrong_dimensions: review.wrong_dimensions || [],
          note: review.note || '',
          updated_at: review.updated_at,
        }
      : {
          verdict: VERDICT_UNSET,
          wrong_dimensions: [],
          note: '',
          updated_at: null,
        },
  };
}
