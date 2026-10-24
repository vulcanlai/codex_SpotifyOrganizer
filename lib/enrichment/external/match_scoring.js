/**
 * 本機 Spotify 列與外部候選之比對（不得僅因排名第一即採信）
 */

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function token_set_ratio(a, b) {
  const ta = norm(a).split(' ').filter(Boolean);
  const tb = norm(b).split(' ').filter(Boolean);
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
 * @param {import('./provider_base.js').ExternalTrackInput} input
 * @param {import('./provider_base.js').ExternalCandidate} cand
 */
/**
 * @param {import('./provider_base.js').ExternalTrackInput} input
 * @param {import('./provider_base.js').ExternalCandidate} cand
 * @param {{ extra_artist_names?: string[] }} [opts]
 */
export function score_candidate(input, cand, opts) {
  const options = opts || {};
  const reasons = [];
  let score = 0;

  const title_sim = token_set_ratio(input.title, cand.title);
  score += title_sim * 40;
  if (title_sim >= 0.85) {
    reasons.push('歌名高度相似（' + Math.round(title_sim * 100) + '%）');
  } else if (title_sim >= 0.5) {
    reasons.push('歌名部分相似（' + Math.round(title_sim * 100) + '%）');
  } else {
    reasons.push('歌名相似度偏低');
  }

  const extra = options.extra_artist_names || [];
  const local_artists = [];
  const seen_local = {};
  function push_local(n) {
    const t = String(n || '').trim();
    if (!t) {
      return;
    }
    const k = t.toLowerCase();
    if (seen_local[k]) {
      return;
    }
    seen_local[k] = true;
    local_artists.push(t);
  }
  const base_art = input.artists || [];
  for (let b = 0; b < base_art.length; b += 1) {
    push_local(base_art[b]);
  }
  for (let e = 0; e < extra.length; e += 1) {
    push_local(extra[e]);
  }
  const ext_artists = cand.artist_names || [];
  let artist_best = 0;
  for (let i = 0; i < local_artists.length; i += 1) {
    for (let j = 0; j < ext_artists.length; j += 1) {
      const r = token_set_ratio(local_artists[i], ext_artists[j]);
      if (r > artist_best) {
        artist_best = r;
      }
    }
  }
  score += artist_best * 35;
  if (artist_best >= 0.7) {
    reasons.push('藝人名稱吻合');
  } else if (artist_best >= 0.4) {
    reasons.push('藝人名稱部分吻合');
  } else {
    reasons.push('藝人名稱吻合度不足');
  }

  if (input.album_name && cand.first_release_date) {
    score += 5;
    reasons.push('具發行日期線索（未驗證專輯名完全一致）');
  }

  if (
    input.duration_ms != null &&
    cand.duration_ms != null &&
    input.duration_ms > 0 &&
    cand.duration_ms > 0
  ) {
    const diff = Math.abs(input.duration_ms - cand.duration_ms);
    if (diff <= 3000) {
      score += 20;
      reasons.push('曲長與外部錄音接近（±3 秒）');
    } else if (diff <= 15000) {
      score += 8;
      reasons.push('曲長接近但可能有編輯差異');
    } else {
      reasons.push('曲長差異大，可能為不同版本');
    }
  }

  return {
    match_score: Math.round(Math.min(100, score)),
    match_reasons: reasons,
    artist_best_ratio: artist_best,
  };
}

/** 可靠比對門檻（非 ISRC 直配） */
export const MATCH_RELIABLE_THRESHOLD = 72;

/** 歧義：前兩名分數接近 */
export const AMBIGUOUS_SCORE_GAP = 8;

/**
 * @param {import('./provider_base.js').ExternalCandidate[]} ranked
 */
export function detect_ambiguity(ranked) {
  if (!ranked || ranked.length < 2) {
    return false;
  }
  const a = ranked[0].match_score || 0;
  const b = ranked[1].match_score || 0;
  return a >= MATCH_RELIABLE_THRESHOLD - 5 && a - b < AMBIGUOUS_SCORE_GAP;
}
