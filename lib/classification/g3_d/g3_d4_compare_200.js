/**
 * G3-D.4 合併 D.3 + D.4 候選 vs D.1/D.2 比較（200 首）
 */
import fs from 'node:fs';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { auto_review_ai_draft_with_quality } from './auto_review_quality.js';
import { FILE_G3_D2_QUALITY_OVERLAY } from './paths_d2.js';
import { FILE_G3_D3_AGENT_DRAFTS_30 } from './paths_d3.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';

function has_instrumental_tag(row) {
  const specs = row.special_types || [];
  for (let i = 0; i < specs.length; i += 1) {
    if ((specs[i].value || specs[i]) === '純音樂') {
      return true;
    }
  }
  return false;
}

/**
 * @param {string[]} d1_ids
 * @param {Record<string, object>} d1_by
 * @param {object[]} d34_rows merged agent candidates
 */
export function compare_d1_d2_d34_200(d1_ids, d1_by, d34_rows) {
  const ov = JSON.parse(fs.readFileSync(FILE_G3_D2_QUALITY_OVERLAY, 'utf8'));
  const ov_by = {};
  for (let i = 0; i < ov.tracks.length; i += 1) {
    ov_by[ov.tracks[i].track_id] = ov.tracks[i];
  }
  const ev = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};

  const d34_by = {};
  for (let j = 0; j < d34_rows.length; j += 1) {
    d34_by[d34_rows[j].track_id] = d34_rows[j];
  }

  const stats = {
    sample_size: d1_ids.length,
    agent_candidate_count: d34_rows.length,
    primary_genre_changed: 0,
    unknown_improved: 0,
    unknown_regressed: 0,
    soundtrack_instrumental_changed: 0,
    instrumental_tag_changed: 0,
    language_changed: 0,
    confidence_tier_changed: 0,
    needs_evidence: 0,
    classification_unknown_quality: 0,
    primary_genre_unknown_count: 0,
    rule_vs_agent_conflict: 0,
    needs_human_decision: 0,
  };

  /** @type {object[]} */
  const per_track = [];

  for (let n = 0; n < d1_ids.length; n += 1) {
    const id = d1_ids[n];
    const d1 = d1_by[id];
    const d34 = d34_by[id];
    const d2 = ov_by[id];
    const evt = ev[id];
    const rule = evt ? rule_classify_track(evt) : {};

    if (!d34) {
      per_track.push({
        track_id: id,
        missing_agent_candidate: true,
        d1_primary: d1 ? d1.genre_profile.primary_genre : null,
      });
      continue;
    }

    const review = auto_review_ai_draft_with_quality(evt, rule, d34);
    const d1_pk = d1.genre_profile.primary_genre;
    const d34_pk = d34.genre_profile.primary_genre;

    if (d34_pk === GENRE_PRIMARY_UNKNOWN || d34_pk === 'unknown') {
      stats.primary_genre_unknown_count += 1;
    }
    if (review.quality_status === 'classification_unknown') {
      stats.classification_unknown_quality += 1;
    }
    if (review.quality_status === 'needs_evidence') {
      stats.needs_evidence += 1;
    }

    if (d1_pk !== d34_pk) {
      stats.primary_genre_changed += 1;
      if (d1_pk === 'unknown' || d1_pk === GENRE_PRIMARY_UNKNOWN) {
        stats.unknown_improved += 1;
      } else if (d34_pk === 'unknown' || d34_pk === GENRE_PRIMARY_UNKNOWN) {
        stats.unknown_regressed += 1;
      }
      if (d1_pk !== d34_pk) {
        stats.rule_vs_agent_conflict += 1;
      }
    }

    const d1_st = d1_pk === 'soundtrack_instrumental';
    const d34_st = d34_pk === 'soundtrack_instrumental';
    if (d1_st !== d34_st) {
      stats.soundtrack_instrumental_changed += 1;
    }
    if (has_instrumental_tag(d1) !== has_instrumental_tag(d34)) {
      stats.instrumental_tag_changed += 1;
    }

    const d1_lang = d1.language ? d1.language.value : null;
    const d34_lang = d34.language ? d34.language.value : null;
    if (d1_lang !== d34_lang) {
      stats.language_changed += 1;
    }
    if (d1.confidence_tier !== d34.confidence_tier) {
      stats.confidence_tier_changed += 1;
    }

    const human_decision =
      review.quality_status === 'needs_evidence' ||
      (d1_pk !== d34_pk && review.quality_status !== 'quality_ok');
    if (human_decision) {
      stats.needs_human_decision += 1;
    }

    per_track.push({
      track_id: id,
      d1: {
        primary: d1_pk,
        language: d1_lang,
        tier: d1.confidence_tier,
        instrumental_tag: has_instrumental_tag(d1),
      },
      d2: d2
        ? { quality_status: d2.quality_status, structural_status: d2.structural_status }
        : null,
      d34: {
        primary: d34_pk,
        subgenres: d34.genre_profile.subgenres,
        language: d34_lang,
        tier: d34.confidence_tier,
        quality_status: review.quality_status,
        source: d34.source,
      },
      deltas: {
        primary_changed: d1_pk !== d34_pk,
        unknown_improved:
          (d1_pk === 'unknown' || d1_pk === GENRE_PRIMARY_UNKNOWN) &&
          d34_pk !== 'unknown' &&
          d34_pk !== GENRE_PRIMARY_UNKNOWN,
      },
      needs_human_decision: human_decision,
    });
  }

  return {
    schema_version: 1,
    stats: stats,
    per_track: per_track,
    note_zh:
      'primary_genre_unknown_count 為主曲風欄位；classification_unknown_quality 為 auto_review v2 狀態，兩者分開統計',
  };
}

/**
 * @param {object[]} d3_tracks
 * @param {object[]} d4_tracks
 */
export function merge_d3_d4_candidates(d3_tracks, d4_tracks) {
  /** @type {Record<string, object>} */
  const by_id = {};
  for (let i = 0; i < d3_tracks.length; i += 1) {
    by_id[d3_tracks[i].track_id] = d3_tracks[i];
  }
  for (let j = 0; j < d4_tracks.length; j += 1) {
    if (by_id[d4_tracks[j].track_id]) {
      throw new Error('D.4 覆蓋 D.3 ID：' + d4_tracks[j].track_id);
    }
    by_id[d4_tracks[j].track_id] = d4_tracks[j];
  }
  return by_id;
}

export function load_d3_agent_tracks() {
  const doc = JSON.parse(fs.readFileSync(FILE_G3_D3_AGENT_DRAFTS_30, 'utf8'));
  return doc.tracks || [];
}
