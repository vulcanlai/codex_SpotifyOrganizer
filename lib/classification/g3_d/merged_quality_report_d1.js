/**
 * G3-D.1 200 首合併品質報告
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../../atomic_json.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import { auto_review_ai_draft_batch } from '../g3_b/auto_review.js';
import { FILE_G3_D1_SAMPLE_200, FILE_G3_D1_MERGED_QUALITY, G3_D1_BATCH_DRAFTS_DIR } from './paths_d1.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function load_all_imported() {
  /** @type {object[]} */
  const rows = [];
  if (!fs.existsSync(G3_D1_BATCH_DRAFTS_DIR)) {
    return rows;
  }
  const files = fs.readdirSync(G3_D1_BATCH_DRAFTS_DIR).filter(function (f) {
    return f.endsWith('-imported.json');
  });
  files.sort();
  for (let i = 0; i < files.length; i += 1) {
    const doc = read_json(path.join(G3_D1_BATCH_DRAFTS_DIR, files[i]));
    if (doc && doc.tracks) {
      rows.push.apply(rows, doc.tracks);
    }
  }
  return rows;
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function build_g3_d1_merged_quality_report(opts) {
  const options = opts || {};
  const sample = read_json(FILE_G3_D1_SAMPLE_200);
  const sample_ids = sample ? sample.track_ids : [];
  const rows = load_all_imported();
  const by_id = {};
  for (let i = 0; i < rows.length; i += 1) {
    by_id[rows[i].track_id] = rows[i];
  }

  const ev_index = read_json(file_g3_evidence_index());
  const ev_tracks = ev_index ? ev_index.tracks || {} : {};

  let primary_unknown = 0;
  let low = 0;
  let medium = 0;
  let high = 0;
  const primary_dist = {};
  const lang_dist = {};
  let needs_evidence = 0;
  let conflict = 0;
  let pass_n = 0;

  /** @type {object[]} */
  const ai_rows_for_review = [];
  const rule_by_id = {};
  for (let s = 0; s < sample_ids.length; s += 1) {
    const id = sample_ids[s];
    const row = by_id[id];
    if (!row) {
      continue;
    }
    const ev = ev_tracks[id];
    if (ev) {
      rule_by_id[id] = rule_classify_track(ev);
    }
    ai_rows_for_review.push(row);
    const pg = row.genre_profile || {};
    const pk = pg.primary_genre || GENRE_PRIMARY_UNKNOWN;
    primary_dist[pk] = (primary_dist[pk] || 0) + 1;
    if (pk === GENRE_PRIMARY_UNKNOWN) {
      primary_unknown += 1;
    }
    const tier = row.confidence_tier || 'unknown';
    if (tier === 'low') {
      low += 1;
    } else if (tier === 'medium') {
      medium += 1;
    } else if (tier === 'high') {
      high += 1;
    }
    const lang = row.language && row.language.value ? row.language.value : '未確認';
    lang_dist[lang] = (lang_dist[lang] || 0) + 1;
  }

  const batch_review = auto_review_ai_draft_batch(ai_rows_for_review, ev_tracks, rule_by_id);
  needs_evidence = batch_review.counts.needs_evidence;
  conflict = batch_review.counts.conflict;
  pass_n = batch_review.counts.pass;

  const counts = {
    sample_size: sample_ids.length,
    ai_imported_in_wave: rows.length,
    missing_from_sample: sample_ids.length - Object.keys(by_id).length,
    primary_unknown_count: primary_unknown,
    confidence_tier: { low: low, medium: medium, high: high },
    auto_review: { pass: pass_n, needs_evidence: needs_evidence, conflict: conflict },
    primary_genre_distribution: primary_dist,
    language_distribution: lang_dist,
  };

  const doc = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    counts: counts,
  };

  if (options.write !== false) {
    write_json_atomic(FILE_G3_D1_MERGED_QUALITY, doc);
  }

  return { counts: counts, doc: doc };
}
