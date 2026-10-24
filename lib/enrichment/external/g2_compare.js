/**
 * G1 vs G2 試驗結果比較（離線）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { G1_TRIAL_DIR } from './g1_path_resolve.js';
import { G2_TRIAL_DIR, file_g2_compare_report } from './verify_data_dir.js';
import { load_g1_trial_sample } from './g1_sample.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function count_status(doc) {
  const tracks = doc && doc.tracks ? doc.tracks : {};
  const counts = {};
  const ids = Object.keys(tracks);
  let with_candidates = 0;
  let with_tags = 0;
  let fallback_used = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const row = tracks[ids[i]];
    const st = row.verify_status || 'unknown';
    counts[st] = (counts[st] || 0) + 1;
    if (row.candidates && row.candidates.length) {
      with_candidates += 1;
    }
    const tags = row.facts && row.facts.genre_tags_from_source;
    if (tags && tags.length) {
      with_tags += 1;
    }
    if (row.fallback_search_used) {
      fallback_used += 1;
    }
  }
  return {
    status_counts: counts,
    with_candidates: with_candidates,
    with_genre_tags: with_tags,
    fallback_search_used: fallback_used,
    track_rows: ids.length,
  };
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function build_g1_g2_compare_report(opts) {
  const options = opts || {};
  const sample = load_g1_trial_sample();
  const g1_path = G1_TRIAL_DIR + '/verification-results.json';
  const g2_path = G2_TRIAL_DIR + '/verification-results.json';
  const g1 = read_json(g1_path);
  const g2 = read_json(g2_path);
  const g1_prog = read_json(G1_TRIAL_DIR + '/progress.json');
  const g2_prog = read_json(G2_TRIAL_DIR + '/progress.json');

  const g1_stats = count_status(g1);
  const g2_stats = count_status(g2);

  const per_track = [];
  const ids = sample ? sample.track_ids : [];
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const a = g1 && g1.tracks ? g1.tracks[id] : null;
    const b = g2 && g2.tracks ? g2.tracks[id] : null;
    per_track.push({
      spotify_id: id,
      title: a ? a.source_title : b ? b.source_title : null,
      g1_status: a ? a.verify_status : null,
      g2_status: b ? b.verify_status : null,
      g2_match_tier: b ? b.match_tier : null,
      g2_fallback: b ? !!b.fallback_search_used : false,
    });
  }

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    sample_id: sample ? sample.sample_id : null,
    g1_path: g1_path,
    g2_path: g2_path,
    g1: {
      ...g1_stats,
      network_requests: g1_prog && g1_prog.stats ? g1_prog.stats.network_requests : null,
    },
    g2: {
      ...g2_stats,
      network_requests: g2_prog && g2_prog.stats ? g2_prog.stats.network_requests : null,
    },
    delta: {
      matched:
        (g2_stats.status_counts.matched || 0) - (g1_stats.status_counts.matched || 0),
      error: (g2_stats.status_counts.error || 0) - (g1_stats.status_counts.error || 0),
      ambiguous:
        (g2_stats.status_counts.ambiguous || 0) - (g1_stats.status_counts.ambiguous || 0),
      insufficient:
        (g2_stats.status_counts.insufficient || 0) -
        (g1_stats.status_counts.insufficient || 0),
      not_found:
        (g2_stats.status_counts.not_found || 0) - (g1_stats.status_counts.not_found || 0),
      with_candidates: g2_stats.with_candidates - g1_stats.with_candidates,
      with_genre_tags: g2_stats.with_genre_tags - g1_stats.with_genre_tags,
      extra_network_requests:
        (g2_prog && g2_prog.stats ? g2_prog.stats.network_requests : 0) -
        (g1_prog && g1_prog.stats ? g1_prog.stats.network_requests : 0),
    },
    per_track: per_track,
    note: 'G1 基準檔不可覆寫；G2 寫入 g2-30/。比對分數不是準確率。',
  };

  if (options.write) {
    write_json_atomic(file_g2_compare_report(), report);
  }

  return report;
}
