/**
 * G2.1 離線重播：沿用 G2 已存候選，不呼叫 MusicBrainz
 */
import fs from 'node:fs';
import path from 'node:path';
import { G1_TRIAL_DIR } from './g1_path_resolve.js';
import { build_external_track_input } from './track_input.js';
import { recompute_verification_from_candidates } from './verify_engine.js';
import { build_recording_search_query } from './musicbrainz_provider.js';
import { artist_name_variants_for_track } from './artist_name_variants.js';

export const G2_1_OFFLINE_REPLAY_FILE = path.join(
  path.dirname(G1_TRIAL_DIR),
  'g2-30',
  'g2-1-offline-replay.json'
);

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function build_g2_1_offline_replay_report(opts) {
  const options = opts || {};
  const g2_path = path.join(path.dirname(G1_TRIAL_DIR), 'g2-30', 'verification-results.json');
  const g1_path = path.join(G1_TRIAL_DIR, 'verification-results.json');
  const g2_doc = read_json(g2_path);
  const g1_doc = read_json(g1_path);
  if (!g2_doc || !g2_doc.tracks) {
    throw new Error('缺少 g2-30 verification-results.json');
  }

  const ids = Object.keys(g2_doc.tracks).sort();
  /** @type {object[]} */
  const per_track = [];
  let rescored_changed = 0;
  let search_query_would_change = 0;

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const stored = g2_doc.tracks[id];
    const g1_row = g1_doc && g1_doc.tracks ? g1_doc.tracks[id] : null;
    const input = build_external_track_input(id);
    if (!input) {
      continue;
    }

    const candidates = (stored.candidates || []).map(function (c) {
      return {
        provider: c.provider,
        entity_type: c.entity_type,
        external_id: c.external_id,
        title: c.title,
        artist_names: (c.artist_names || []).slice(),
        duration_ms: c.duration_ms,
        first_release_date: c.first_release_date,
        tags: (c.tags || []).slice(),
        source_url: c.source_url,
        match_score: 0,
        match_reasons: [],
      };
    });

    const isrc_used =
      stored.query_keys_used &&
      stored.query_keys_used.some(function (k) {
        return String(k).indexOf('isrc:') === 0;
      }) &&
      candidates.length > 0 &&
      !stored.fallback_search_used;

    const isrc_keys = (stored.query_keys_used || []).filter(function (k) {
      return String(k).indexOf('isrc:') === 0;
    });
    let isrc_count = 0;
    if (isrc_used) {
      isrc_count = candidates.length;
    }

    const replay = recompute_verification_from_candidates(input, candidates, {
      isrc_used: isrc_used,
      isrc_candidate_count: isrc_count,
      fallback_search_used: !!stored.fallback_search_used,
      query_keys_used: stored.query_keys_used || [],
      verify_engine: 'g2.1-offline',
    });

    const variants = artist_name_variants_for_track(id);
    const new_q = build_recording_search_query(input, {
      search_artist: variants.search_artist,
    });
    const old_search = (stored.query_keys_used || []).filter(function (k) {
      return String(k).indexOf('search:') === 0;
    })[0];
    const query_would_change = old_search ? 'search:' + new_q !== old_search : false;
    if (query_would_change) {
      search_query_would_change += 1;
    }

    const status_changed = stored.verify_status !== replay.verify_status;
    if (status_changed) {
      rescored_changed += 1;
    }

    per_track.push({
      spotify_id: id,
      title: stored.source_title,
      g1_status: g1_row ? g1_row.verify_status : null,
      g2_status: stored.verify_status,
      g2_1_offline_status: replay.verify_status,
      g2_1_match_tier: replay.match_tier,
      artist_match_status: replay.artist_match_status,
      isrc_conflict: replay.isrc_conflict,
      mb_recording_id: replay.best_match ? replay.best_match.external_id : null,
      match_score: replay.best_match ? replay.best_match.match_score : null,
      rescored_status_changed: status_changed,
      fallback_search_query_would_change: query_would_change,
      requires_new_network_search:
        (stored.fallback_search_used || false) && candidates.length === 0,
      improvement_kind: classify_improvement(stored, replay, candidates.length),
    });
  }

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    verify_engine: 'g2.1-offline-replay',
    note: '僅重算已存候選；requires_new_network_search 表示需重跑線上 fallback 才可能改善',
    summary: {
      track_count: per_track.length,
      rescored_status_changed: rescored_changed,
      fallback_query_would_change: search_query_would_change,
      requires_new_network_search: per_track.filter(function (r) {
        return r.requires_new_network_search;
      }).length,
    },
    per_track: per_track,
  };

  if (options.write !== false) {
    fs.writeFileSync(G2_1_OFFLINE_REPLAY_FILE, JSON.stringify(report, null, 2), 'utf8');
  }
  return report;
}

function classify_improvement(stored, replay, cand_len) {
  if (cand_len === 0 && stored.fallback_search_used) {
    return 'needs_research';
  }
  if (stored.verify_status !== replay.verify_status) {
    return 'rescored_from_cached_candidates';
  }
  return 'unchanged';
}
