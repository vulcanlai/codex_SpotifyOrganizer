/**
 * G3-E.2 20 首 D.1 / D.34 / E.2 比較
 */
import fs from 'node:fs';
import path from 'node:path';
import { G3_D1_BATCH_DRAFTS_DIR } from '../g3_d/paths_d1.js';
import { FILE_G3_D4_MERGED_CANDIDATE_200 } from '../g3_d/paths_d4.js';
import { auto_review_ai_draft_with_quality } from '../g3_d/auto_review_quality.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';

function load_d1_by_id() {
  /** @type {Record<string, object>} */
  const by_id = {};
  const files = fs.readdirSync(G3_D1_BATCH_DRAFTS_DIR).filter(function (f) {
    return f.endsWith('-imported.json');
  });
  for (let i = 0; i < files.length; i += 1) {
    const doc = JSON.parse(fs.readFileSync(path.join(G3_D1_BATCH_DRAFTS_DIR, files[i]), 'utf8'));
    for (let t = 0; t < doc.tracks.length; t += 1) {
      by_id[doc.tracks[t].track_id] = doc.tracks[t];
    }
  }
  return by_id;
}

function tag_list(row) {
  return (row.special_types || []).map(function (s) {
    return s.value || s;
  });
}

/**
 * @param {object[]} e2_rows
 * @param {string[]} track_ids
 */
export function compare_d1_d34_e2_20(e2_rows, track_ids) {
  const d1_by = load_d1_by_id();
  const merged = JSON.parse(fs.readFileSync(FILE_G3_D4_MERGED_CANDIDATE_200, 'utf8'));
  const d34_by = {};
  for (let m = 0; m < merged.tracks.length; m += 1) {
    d34_by[merged.tracks[m].track_id] = merged.tracks[m];
  }
  const e2_by = {};
  for (let e = 0; e < e2_rows.length; e += 1) {
    e2_by[e2_rows[e].track_id] = e2_rows[e];
  }
  const ev_all = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};

  const stats = {
    track_count: track_ids.length,
    primary_changed_vs_d1: 0,
    primary_changed_vs_d34: 0,
    language_changed_vs_d1: 0,
    language_changed_vs_d34: 0,
    special_tag_changed_vs_d34: 0,
    tier_changed_vs_d34: 0,
    unknown_improved_vs_d1: 0,
    still_needs_evidence: 0,
  };

  /** @type {object[]} */
  const per_track = [];

  for (let i = 0; i < track_ids.length; i += 1) {
    const id = track_ids[i];
    const d1 = d1_by[id];
    const d34 = d34_by[id];
    const e2 = e2_by[id];
    const ev = ev_all[id];
    const rule = ev ? rule_classify_track(ev) : {};
    const review = e2 ? auto_review_ai_draft_with_quality(ev, rule, e2) : null;

    const d1_pk = d1.genre_profile.primary_genre;
    const d34_pk = d34.genre_profile.primary_genre;
    const e2_pk = e2.genre_profile.primary_genre;

    if (d1_pk !== e2_pk) {
      stats.primary_changed_vs_d1 += 1;
    }
    if (d34_pk !== e2_pk) {
      stats.primary_changed_vs_d34 += 1;
    }
    if (
      (d1_pk === 'unknown' || d1_pk === GENRE_PRIMARY_UNKNOWN) &&
      e2_pk !== 'unknown' &&
      e2_pk !== GENRE_PRIMARY_UNKNOWN
    ) {
      stats.unknown_improved_vs_d1 += 1;
    }

    const d1_lang = d1.language ? d1.language.value : null;
    const d34_lang = d34.language ? d34.language.value : null;
    const e2_lang = e2.language ? e2.language.value : null;
    if (d1_lang !== e2_lang) {
      stats.language_changed_vs_d1 += 1;
    }
    if (d34_lang !== e2_lang) {
      stats.language_changed_vs_d34 += 1;
    }
    if (JSON.stringify(tag_list(d34)) !== JSON.stringify(tag_list(e2))) {
      stats.special_tag_changed_vs_d34 += 1;
    }
    if (d34.confidence_tier !== e2.confidence_tier) {
      stats.tier_changed_vs_d34 += 1;
    }
    if (review && review.quality_status === 'needs_evidence') {
      stats.still_needs_evidence += 1;
    }

    per_track.push({
      track_id: id,
      d1_primary: d1_pk,
      d34_primary: d34_pk,
      e2_primary: e2_pk,
      e2_quality: review ? review.quality_status : null,
    });
  }

  return { schema_version: 1, stats: stats, per_track: per_track };
}
