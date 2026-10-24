/**
 * G3-D.5 needs_evidence 欄位／原因分類
 */
import fs from 'node:fs';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { auto_review_ai_draft_with_quality, QUALITY_NEEDS_EVIDENCE } from './auto_review_quality.js';
import { FILE_G3_D4_MERGED_CANDIDATE_200 } from './paths_d4.js';
import { REVIEW_CONFLICT } from '../g3_b/auto_review.js';

export const NE_BUCKET_NON_CRITICAL = 'missing_non_critical_field';
export const NE_BUCKET_PRIMARY = 'primary_genre_insufficient';
export const NE_BUCKET_LANGUAGE = 'vocal_language_uncertain';
export const NE_BUCKET_VERSION = 'version_uncertain';
export const NE_BUCKET_CONFLICT = 'source_conflict';
export const NE_BUCKET_HUMAN = 'needs_human_decision';

/**
 * @param {object} row candidate
 * @param {object} ev evidence
 * @param {object} review auto_review with quality
 */
export function classify_needs_evidence_buckets(row, ev, review) {
  /** @type {string[]} */
  const track_buckets = [];
  /** @type {object[]} */
  const field_tasks = [];

  if (!review || review.quality_status !== QUALITY_NEEDS_EVIDENCE) {
    return { track_buckets: track_buckets, field_tasks: field_tasks };
  }

  const identity = ev && ev.identity ? ev.identity : {};
  const sparse =
    !identity.enrichment_cache_complete && !identity.isrc && !identity.album_name;
  const issues = review.quality_issues || [];

  if (review.status === REVIEW_CONFLICT) {
    track_buckets.push(NE_BUCKET_CONFLICT);
    field_tasks.push({ field: 'classification', bucket: NE_BUCKET_CONFLICT, reason_zh: '結構 conflict' });
  }
  if (review.needs_human_decision) {
    track_buckets.push(NE_BUCKET_HUMAN);
    field_tasks.push({ field: 'classification', bucket: NE_BUCKET_HUMAN, reason_zh: '需人工決策' });
  }

  for (let i = 0; i < issues.length; i += 1) {
    const iss = issues[i];
    if (iss.indexOf('metadata 稀疏') >= 0) {
      track_buckets.push(NE_BUCKET_PRIMARY);
      field_tasks.push({ field: 'primary_genre', bucket: NE_BUCKET_PRIMARY, reason_zh: iss });
    }
    if (iss.indexOf('confidence_tier=low') >= 0) {
      track_buckets.push(NE_BUCKET_PRIMARY);
      field_tasks.push({ field: 'confidence_tier', bucket: NE_BUCKET_PRIMARY, reason_zh: iss });
    }
    if (iss.indexOf('純音樂') >= 0) {
      field_tasks.push({ field: 'special_types', bucket: NE_BUCKET_NON_CRITICAL, reason_zh: iss });
      track_buckets.push(NE_BUCKET_NON_CRITICAL);
    }
    if (iss.indexOf('配樂但未標') >= 0) {
      field_tasks.push({ field: 'language', bucket: NE_BUCKET_LANGUAGE, reason_zh: iss });
      track_buckets.push(NE_BUCKET_LANGUAGE);
    }
  }

  const uv = row.unverified_fields || [];
  for (let u = 0; u < uv.length; u += 1) {
    if (uv[u] === 'vocal_language') {
      track_buckets.push(NE_BUCKET_LANGUAGE);
      field_tasks.push({
        field: 'language',
        bucket: NE_BUCKET_LANGUAGE,
        reason_zh: 'unverified_fields 含 vocal_language',
      });
    } else if (uv[u] === 'recording_version' || uv[u] === 'version') {
      track_buckets.push(NE_BUCKET_VERSION);
      field_tasks.push({ field: 'version', bucket: NE_BUCKET_VERSION, reason_zh: uv[u] });
    } else if (uv[u] === 'primary_genre' || uv[u] === 'instrumental_vs_vocal') {
      track_buckets.push(NE_BUCKET_PRIMARY);
      field_tasks.push({ field: uv[u], bucket: NE_BUCKET_PRIMARY, reason_zh: '主曲風或器樂未核實' });
    } else {
      track_buckets.push(NE_BUCKET_NON_CRITICAL);
      field_tasks.push({ field: uv[u], bucket: NE_BUCKET_NON_CRITICAL, reason_zh: '非關鍵欄位待補' });
    }
  }

  if (row.version_uncertainty === true) {
    track_buckets.push(NE_BUCKET_VERSION);
    field_tasks.push({ field: 'version', bucket: NE_BUCKET_VERSION, reason_zh: 'version_uncertainty=true' });
  }

  if (sparse && row.confidence_tier !== 'low' && track_buckets.indexOf(NE_BUCKET_PRIMARY) < 0) {
    track_buckets.push(NE_BUCKET_PRIMARY);
    field_tasks.push({
      field: 'primary_genre',
      bucket: NE_BUCKET_PRIMARY,
      reason_zh: 'sparse metadata + medium/high tier',
    });
  }

  const uniq_buckets = [];
  for (let b = 0; b < track_buckets.length; b += 1) {
    if (uniq_buckets.indexOf(track_buckets[b]) < 0) {
      uniq_buckets.push(track_buckets[b]);
    }
  }

  return { track_buckets: uniq_buckets, field_tasks: field_tasks };
}

export function analyze_needs_evidence_200() {
  const merged = JSON.parse(fs.readFileSync(FILE_G3_D4_MERGED_CANDIDATE_200, 'utf8'));
  const tracks = merged.tracks || [];
  const ev_all = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};

  let needs_evidence_track_count = 0;
  const track_count_by_bucket = {};
  let field_task_count = 0;
  /** @type {object[]} */
  const per_track = [];

  for (let i = 0; i < tracks.length; i += 1) {
    const row = tracks[i];
    const ev = ev_all[row.track_id];
    const rule = ev ? rule_classify_track(ev) : {};
    const review = auto_review_ai_draft_with_quality(ev, rule, row);
    const buckets = classify_needs_evidence_buckets(row, ev, review);

    if (review.quality_status === QUALITY_NEEDS_EVIDENCE) {
      needs_evidence_track_count += 1;
    }

    for (let t = 0; t < buckets.track_buckets.length; t += 1) {
      const bk = buckets.track_buckets[t];
      track_count_by_bucket[bk] = (track_count_by_bucket[bk] || 0) + 1;
    }
    field_task_count += buckets.field_tasks.length;

    if (review.quality_status === QUALITY_NEEDS_EVIDENCE) {
      per_track.push({
        track_id: row.track_id,
        title: row.title,
        quality_issues: review.quality_issues,
        track_buckets: buckets.track_buckets,
        field_tasks: buckets.field_tasks,
        usable_with_gaps:
          buckets.track_buckets.length === 1 &&
          buckets.track_buckets[0] === NE_BUCKET_NON_CRITICAL,
      });
    }
  }

  return {
    schema_version: 1,
    needs_evidence_track_count: needs_evidence_track_count,
    note_zh: 'track_count_by_bucket 為「至少含該原因」的歌曲次數，可重疊；field_task_count 為欄位任務總數',
    track_count_by_bucket: track_count_by_bucket,
    field_task_count: field_task_count,
    per_track_needs_evidence: per_track,
  };
}
