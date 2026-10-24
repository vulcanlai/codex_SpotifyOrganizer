/**
 * G3-D.3 D.1 / D.2 / D.3 比較
 */
import fs from 'node:fs';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { auto_review_ai_draft_with_quality } from './auto_review_quality.js';
import { FILE_G3_D2_QUALITY_OVERLAY } from './paths_d2.js';
import { validate_genre_profile_draft } from '../g3_b/rule_classify.js';

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
 * @param {object[]} d1_rows
 * @param {object[]} d3_rows
 * @param {object} sample_doc
 */
export function compare_d1_d2_d3(d1_rows, d3_rows, sample_doc) {
  const ov = JSON.parse(fs.readFileSync(FILE_G3_D2_QUALITY_OVERLAY, 'utf8'));
  const ov_by = {};
  for (let i = 0; i < ov.tracks.length; i += 1) {
    ov_by[ov.tracks[i].track_id] = ov.tracks[i];
  }
  const d1_by = {};
  for (let j = 0; j < d1_rows.length; j += 1) {
    d1_by[d1_rows[j].track_id] = d1_rows[j];
  }
  const d3_by = {};
  for (let k = 0; k < d3_rows.length; k += 1) {
    d3_by[d3_rows[k].track_id] = d3_rows[k];
  }

  const ev = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};

  const stats = {
    primary_genre_changed: 0,
    instrumental_tag_changed: 0,
    unknown_improved: 0,
    confidence_tier_changed: 0,
    language_changed: 0,
    still_needs_evidence: 0,
    rule_vs_agent_conflict: 0,
  };

  /** @type {object[]} */
  const per_track = [];

  const ids = sample_doc.tracks.map(function (t) {
    return t.track_id;
  });

  for (let n = 0; n < ids.length; n += 1) {
    const id = ids[n];
    const d1 = d1_by[id];
    const d3 = d3_by[id];
    const d2 = ov_by[id];
    const evt = ev[id];
    const rule = evt ? rule_classify_track(evt) : {};
    const d3_review = d3
      ? auto_review_ai_draft_with_quality(evt, rule, d3)
      : null;

    const d1_pk = d1.genre_profile.primary_genre;
    const d3_pk = d3.genre_profile.primary_genre;
    if (d1_pk !== d3_pk) {
      stats.primary_genre_changed += 1;
    }
    const d1_inst = has_instrumental_tag(d1);
    const d3_inst = has_instrumental_tag(d3);
    if (d1_inst !== d3_inst) {
      stats.instrumental_tag_changed += 1;
    }
    if (d1_pk === 'unknown' && d3_pk !== 'unknown') {
      stats.unknown_improved += 1;
    }
    if (d1.confidence_tier !== d3.confidence_tier) {
      stats.confidence_tier_changed += 1;
    }
    const d1_lang = d1.language && d1.language.value;
    const d3_lang = d3.language && d3.language.value;
    if (d1_lang !== d3_lang) {
      stats.language_changed += 1;
    }
    if (
      d3_review &&
      (d3_review.quality_status === 'needs_evidence' ||
        d3_review.quality_status === 'classification_unknown')
    ) {
      stats.still_needs_evidence += 1;
    }
    if (d1_pk !== d3_pk && d1.reason_zh !== d3.reason_zh) {
      stats.rule_vs_agent_conflict += 1;
    }

    per_track.push({
      track_id: id,
      cohort: sample_doc.tracks[n].cohort,
      title: d1.title,
      d1: {
        primary: d1_pk,
        language: d1_lang,
        tier: d1.confidence_tier,
        instrumental_tag: d1_inst,
        reason_zh: d1.reason_zh,
        inference_source: 'rule_g3_d1_evidence_classify',
      },
      d2: {
        quality_status: d2 ? d2.quality_status : null,
        structural_status: d2 ? d2.structural_status : null,
      },
      d3: {
        primary: d3_pk,
        subgenres: d3.genre_profile.subgenres,
        secondary_genres: d3.genre_profile.secondary_genres,
        language: d3_lang,
        tier: d3.confidence_tier,
        instrumental_tag: d3_inst,
        special_types: d3.special_types,
        reason_zh: d3.reason_zh,
        quality_status: d3_review ? d3_review.quality_status : null,
        source: 'cursor_agent_g3_d3_repair',
        dictionary_valid: validate_genre_profile_draft(d3.genre_profile),
      },
      deltas: {
        primary_changed: d1_pk !== d3_pk,
        unknown_improved: d1_pk === 'unknown' && d3_pk !== 'unknown',
        language_changed: d1_lang !== d3_lang,
        instrumental_tag_changed: d1_inst !== d3_inst,
      },
    });
  }

  return {
    schema_version: 1,
    sample_size: ids.length,
    stats: stats,
    per_track: per_track,
    note_zh: 'D.3 為候選建議；未寫入 batch-drafts；衝突指主曲風與理由皆變',
  };
}
