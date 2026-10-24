/**
 * 外部查證引擎 G1（legacy）與 G2（ISRC fallback）
 */
import { VERIFY_STATUS } from './paths.js';
import { musicbrainz_provider } from './musicbrainz_provider.js';
import {
  score_candidate,
  detect_ambiguity,
  MATCH_RELIABLE_THRESHOLD,
} from './match_scoring.js';
import {
  build_fact_layer,
  build_inference_layer,
  build_unknown_layer,
} from './facts_layer.js';
import { build_track_result_row } from './verification_store.js';
import {
  get_cached_query,
  put_cached_query,
} from './verification_store.js';
import { artist_name_variants_for_track } from './artist_name_variants.js';
import {
  evaluate_isrc_artist_evidence,
  resolve_match_tier,
} from './verify_match_tier.js';
/**
 * @param {import('./provider_base.js').ExternalCandidate[]} candidates
 * @param {import('./provider_base.js').ExternalTrackInput} input
 * @param {string[]} extra_artists
 */
function rank_candidates(candidates, input, extra_artists) {
  const ranked = [];
  const extras = extra_artists || [];
  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    const scored = score_candidate(input, c, { extra_artist_names: extras });
    ranked.push({
      provider: c.provider,
      entity_type: c.entity_type,
      external_id: c.external_id,
      title: c.title,
      artist_names: c.artist_names.slice(),
      duration_ms: c.duration_ms,
      first_release_date: c.first_release_date,
      tags: (c.tags || []).slice(),
      source_url: c.source_url,
      match_score: scored.match_score,
      match_reasons: scored.match_reasons.slice(),
      artist_best_ratio: scored.artist_best_ratio,
    });
  }
  ranked.sort(function (a, b) {
    if (b.match_score !== a.match_score) {
      return b.match_score - a.match_score;
    }
    return a.external_id < b.external_id ? -1 : 1;
  });
  return ranked;
}

async function cached_lookup(ctx, query_key_hint, fetch_fn_inner) {
  if (query_key_hint) {
    const hit = get_cached_query(ctx.cache, query_key_hint);
    if (hit) {
      ctx.progress.stats.cache_hits += 1;
      return {
        from_cache: true,
        query_key: query_key_hint,
        candidates: hit.candidates || [],
        raw: hit.raw || null,
      };
    }
  }
  ctx.progress.stats.network_requests += 1;
  const result = await fetch_fn_inner();
  const query_key = result.query_key || query_key_hint;
  if (query_key) {
    put_cached_query(ctx.cache, query_key, {
      fetched_at: new Date().toISOString(),
      provider: musicbrainz_provider.id,
      query_key: query_key,
      candidates: result.candidates,
      raw: null,
    });
  }
  return {
    from_cache: false,
    query_key: query_key,
    candidates: result.candidates,
    raw: result.raw,
  };
}

/**
 * @param {object} ranked
 * @param {boolean} isrc_exact
 * @param {boolean} isrc_conflict
 */
function decide_verify_status(ranked, isrc_exact, isrc_conflict) {
  const version_ambiguous = detect_ambiguity(ranked);
  let verify_status = VERIFY_STATUS.not_found;
  let best = null;

  if (!ranked.length) {
    verify_status = VERIFY_STATUS.not_found;
  } else if (isrc_conflict) {
    verify_status = version_ambiguous ? VERIFY_STATUS.ambiguous : VERIFY_STATUS.insufficient;
    best = ranked[0];
  } else if (isrc_exact && ranked[0].match_score >= 50) {
    verify_status = version_ambiguous ? VERIFY_STATUS.ambiguous : VERIFY_STATUS.matched;
    best = ranked[0];
  } else if (ranked[0].match_score >= MATCH_RELIABLE_THRESHOLD && !version_ambiguous) {
    verify_status = VERIFY_STATUS.matched;
    best = ranked[0];
  } else if (ranked[0].match_score >= 45) {
    verify_status = version_ambiguous ? VERIFY_STATUS.ambiguous : VERIFY_STATUS.insufficient;
    best = ranked[0];
  } else {
    verify_status = VERIFY_STATUS.insufficient;
    best = ranked[0];
  }

  if (ranked.length && verify_status === VERIFY_STATUS.not_found) {
    verify_status = VERIFY_STATUS.candidates_found;
  }

  return { verify_status, best, version_ambiguous };
}

function finalize_row(input, ctx_meta, ranked, decision, flags) {
  const best = decision.best;
  let isrc_conflict = false;
  let artist_match_status = null;
  let artist_evidence_sources = [];
  let isrc_conflict_reasons = [];

  if (flags.isrc_used && best) {
    const ev = evaluate_isrc_artist_evidence({
      input: input,
      best: best,
      extra_artist_names: flags.extra_artist_names || [],
      isrc_candidate_count: flags.isrc_candidate_count,
      evidence_sources: flags.artist_evidence_sources || [],
    });
    isrc_conflict = ev.isrc_conflict;
    artist_match_status = ev.artist_match_status;
    artist_evidence_sources = ev.artist_evidence_sources || [];
    isrc_conflict_reasons = ev.conflict_reasons || [];
  }

  let verify_status = decision.verify_status;
  let version_ambiguous = decision.version_ambiguous;
  if (isrc_conflict && verify_status === VERIFY_STATUS.matched) {
    verify_status = version_ambiguous ? VERIFY_STATUS.ambiguous : VERIFY_STATUS.insufficient;
  }

  const tier = resolve_match_tier({
    verify_status: verify_status,
    version_ambiguous: version_ambiguous,
    best_match: best,
    isrc_used: flags.isrc_used && !isrc_conflict,
    isrc_conflict: isrc_conflict,
    artist_match_status: artist_match_status,
  });

  const facts = build_fact_layer(
    best,
    flags.isrc_used && verify_status === VERIFY_STATUS.matched && !isrc_conflict
  );
  const inference = build_inference_layer(facts);
  const unknown = build_unknown_layer(verify_status, version_ambiguous);

  return build_track_result_row(input, {
    provider: musicbrainz_provider.id,
    verify_status: verify_status,
    version_ambiguous: version_ambiguous,
    best_match: best,
    candidates: ranked.slice(0, 8),
    facts: facts,
    inference: inference,
    unknown: unknown,
    query_keys_used: flags.query_keys_used,
    verify_engine: ctx_meta.verify_engine,
    match_tier: tier.match_tier,
    match_tier_note: tier.match_tier_note,
    isrc_conflict: isrc_conflict,
    fallback_search_used: flags.fallback_search_used,
    artist_match_status: artist_match_status,
    artist_evidence_sources: artist_evidence_sources,
    isrc_conflict_reasons: isrc_conflict_reasons,
  });
}

/**
 * G2.1：自候選重算（離線重播用）
 * @param {import('./provider_base.js').ExternalTrackInput} input
 * @param {import('./provider_base.js').ExternalCandidate[]} candidates
 * @param {object} flags
 */
export function recompute_verification_from_candidates(input, candidates, flags) {
  const f = flags || {};
  const variants = artist_name_variants_for_track(input.spotify_id);
  const extra = variants.names;
  const ranked = rank_candidates(candidates || [], input, extra);
  const isrc_exact = !!f.isrc_used;
  const isrc_count =
    typeof f.isrc_candidate_count === 'number'
      ? f.isrc_candidate_count
      : isrc_exact
        ? (candidates || []).length
        : 0;
  const decision = decide_verify_status(ranked, isrc_exact, false);
  return finalize_row(input, { verify_engine: f.verify_engine || 'g2.1' }, ranked, decision, {
    isrc_used: isrc_exact,
    query_keys_used: f.query_keys_used || [],
    fallback_search_used: !!f.fallback_search_used,
    extra_artist_names: extra,
    isrc_candidate_count: isrc_count,
    artist_evidence_sources: variants.evidence_sources || [],
  });
}

/**
 * G1：ISRC 404 拋錯（維持舊行為，不寫入 G1 基準檔）
 */
export async function verify_track_online_v1(input, ctx) {
  const query_keys_used = [];
  let all_candidates = [];
  let isrc_exact = false;

  if (input.isrc) {
    const qk = 'isrc:' + input.isrc.toUpperCase();
    const res = await cached_lookup(ctx, qk, function () {
      return musicbrainz_provider.lookup_by_isrc(ctx.fetch_fn, input.isrc);
    });
    query_keys_used.push(res.query_key);
    if (res.candidates && res.candidates.length) {
      isrc_exact = true;
      all_candidates = all_candidates.concat(res.candidates);
    }
  }

  if (!all_candidates.length) {
    const search = await cached_lookup(ctx, null, function () {
      return musicbrainz_provider.search_recording(ctx.fetch_fn, input);
    });
    query_keys_used.push(search.query_key);
    all_candidates = search.candidates || [];
  }

  const ranked = rank_candidates(all_candidates, input, []);
  const decision = decide_verify_status(ranked, isrc_exact, false);
  return finalize_row(input, { verify_engine: 'g1' }, ranked, decision, {
    isrc_used: isrc_exact,
    query_keys_used: query_keys_used,
    fallback_search_used: false,
  });
}

/**
 * G2：ISRC 404 → 最多 1 次備援搜尋
 */
export async function verify_track_online_v2(input, ctx) {
  const query_keys_used = [];
  let all_candidates = [];
  let isrc_exact = false;
  let isrc_attempted = false;
  let fallback_search_used = false;

  const variants = artist_name_variants_for_track(input.spotify_id);
  const extra_artists = variants.names;

  if (input.isrc) {
    isrc_attempted = true;
    const qk = 'isrc:' + input.isrc.toUpperCase();
    const res = await cached_lookup(ctx, qk, function () {
      return musicbrainz_provider.lookup_by_isrc_safe(ctx.fetch_fn, input.isrc).then(
        function (safe) {
          if (safe.outcome === 'retryable_error') {
            throw safe.error;
          }
          return {
            query_key: safe.query_key,
            candidates: safe.candidates,
            raw: safe.raw,
          };
        }
      );
    });
    query_keys_used.push(res.query_key);
    if (res.candidates && res.candidates.length) {
      isrc_exact = true;
      all_candidates = all_candidates.concat(res.candidates);
    }
  }

  const need_search = !all_candidates.length;
  if (need_search) {
    fallback_search_used = isrc_attempted;
    const search = await cached_lookup(ctx, null, function () {
      return musicbrainz_provider.search_recording(ctx.fetch_fn, input, {
        search_artist: variants.search_artist,
      });
    });
    query_keys_used.push(search.query_key);
    all_candidates = search.candidates || [];
  }

  const isrc_candidate_count = isrc_exact ? all_candidates.length : 0;
  const ranked = rank_candidates(all_candidates, input, extra_artists);
  const decision = decide_verify_status(ranked, isrc_exact, false);
  return finalize_row(input, { verify_engine: 'g2.1' }, ranked, decision, {
    isrc_used: isrc_exact,
    query_keys_used: query_keys_used,
    fallback_search_used: fallback_search_used,
    extra_artist_names: extra_artists,
    isrc_candidate_count: isrc_candidate_count,
    artist_evidence_sources: variants.evidence_sources || [],
  });
}

/**
 * @param {import('./provider_base.js').ExternalTrackInput} input
 * @param {'g1'|'g2'} [engine]
 */
export function preview_track_offline(input, engine) {
  const eng = engine === 'g2' ? 'g2' : 'g1';
  const plan = [];
  if (input.isrc) {
    plan.push({ step: 'isrc_lookup', query_key: 'isrc:' + input.isrc.toUpperCase() });
  }
  if (eng === 'g2') {
    plan.push({
      step: 'fallback_recording_search',
      note: 'ISRC 404 或無錄音時，最多 1 次歌名＋藝人搜尋',
    });
  } else {
    plan.push({ step: 'recording_search', note: '若 ISRC 無結果（G1 404 可能 error）' });
  }
  if (eng === 'g2') {
    const v = artist_name_variants_for_track(input.spotify_id);
    if (v.names.length > 1) {
      plan.push({
        step: 'artist_variants',
        names: v.names,
        search_artist: v.search_artist,
      });
    }
  }
  return {
    spotify_id: input.spotify_id,
    title: input.title,
    artists: input.artists,
    album_name: input.album_name,
    isrc: input.isrc,
    duration_ms: input.duration_ms,
    plan: plan,
    verify_engine: eng,
  };
}
