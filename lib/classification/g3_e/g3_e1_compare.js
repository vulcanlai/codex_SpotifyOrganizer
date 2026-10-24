/**
 * G3-E.1 D.1 / D.34 / E.1 比較
 */
import fs from 'node:fs';
import path from 'node:path';
import { G3_D1_BATCH_DRAFTS_DIR } from '../g3_d/paths_d1.js';
import { FILE_G3_D4_MERGED_CANDIDATE_200 } from '../g3_d/paths_d4.js';
import { auto_review_ai_draft_with_quality } from '../g3_d/auto_review_quality.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';

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

function has_pure(row) {
  const specs = row.special_types || [];
  for (let i = 0; i < specs.length; i += 1) {
    if ((specs[i].value || specs[i]) === '純音樂') {
      return true;
    }
  }
  return false;
}

/**
 * @param {object[]} e1_rows
 * @param {string[]} track_ids
 */
export function compare_d1_d34_e1(e1_rows, track_ids) {
  const d1_by = load_d1_by_id();
  const merged = JSON.parse(fs.readFileSync(FILE_G3_D4_MERGED_CANDIDATE_200, 'utf8'));
  const d34_by = {};
  for (let m = 0; m < merged.tracks.length; m += 1) {
    d34_by[merged.tracks[m].track_id] = merged.tracks[m];
  }
  const e1_by = {};
  for (let e = 0; e < e1_rows.length; e += 1) {
    e1_by[e1_rows[e].track_id] = e1_rows[e];
  }
  const ev_all = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};

  /** @type {object[]} */
  const per_track = [];

  for (let i = 0; i < track_ids.length; i += 1) {
    const id = track_ids[i];
    const d1 = d1_by[id];
    const d34 = d34_by[id];
    const e1 = e1_by[id];
    const ev = ev_all[id];
    const rule = ev ? rule_classify_track(ev) : {};
    const review = e1 ? auto_review_ai_draft_with_quality(ev, rule, e1) : null;

    per_track.push({
      track_id: id,
      d1: d1
        ? {
            primary: d1.genre_profile.primary_genre,
            language: d1.language ? d1.language.value : null,
            tier: d1.confidence_tier,
            pure_tag: has_pure(d1),
            reason_zh: d1.reason_zh,
          }
        : null,
      d34: d34
        ? {
            primary: d34.genre_profile.primary_genre,
            language: d34.language ? d34.language.value : null,
            tier: d34.confidence_tier,
            pure_tag: has_pure(d34),
            source: d34.source,
          }
        : null,
      e1: e1
        ? {
            primary: e1.genre_profile.primary_genre,
            language: e1.language ? e1.language.value : null,
            tier: e1.confidence_tier,
            pure_tag: has_pure(e1),
            provenance: e1.provenance,
          }
        : null,
      deltas: {
        d1_vs_e1_primary: d1 && e1 ? d1.genre_profile.primary_genre !== e1.genre_profile.primary_genre : null,
        d34_vs_e1_primary: d34 && e1 ? d34.genre_profile.primary_genre !== e1.genre_profile.primary_genre : null,
        d1_vs_e1_language:
          d1 && e1 && d1.language && e1.language ? d1.language.value !== e1.language.value : null,
      },
      e1_quality_status: review ? review.quality_status : null,
      still_needs_evidence: review ? review.quality_status === 'needs_evidence' : null,
      traceable_e1: e1 && e1.provenance ? e1.provenance.status === 'agent_workflow_declared' : false,
    });
  }

  return {
    schema_version: 1,
    track_count: track_ids.length,
    disclaimer_zh: '不比較準確率；E.1 為新 workflow 候選',
    per_track: per_track,
  };
}
