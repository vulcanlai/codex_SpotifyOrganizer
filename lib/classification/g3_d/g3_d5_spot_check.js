/**
 * G3-D.5 40 首抽查比對（D.5 判斷為 AI 意見，非準確率）
 */
import fs from 'node:fs';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { auto_review_ai_draft_with_quality } from './auto_review_quality.js';
import { G3_D1_BATCH_DRAFTS_DIR } from './paths_d1.js';
import path from 'node:path';
import { FILE_G3_D2_QUALITY_OVERLAY } from './paths_d2.js';
import { FILE_G3_D4_MERGED_CANDIDATE_200 } from './paths_d4.js';

const VERDICT_ADOPT_OK = '可以作為 AI 候選採用';
const VERDICT_ADOPT_GAPS = '可以採用，但需保留證據不足標記';
const VERDICT_DEFER = '建議暫緩採用';
const VERDICT_CONFLICT = '存在明確衝突';
const VERDICT_INSUFFICIENT = '資料不足，無法判斷';

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

function has_pure_instrumental(row) {
  const specs = row.special_types || [];
  for (let i = 0; i < specs.length; i += 1) {
    if ((specs[i].value || specs[i]) === '純音樂') {
      return true;
    }
  }
  return false;
}

/**
 * @param {object} sample_doc
 * @param {Record<string, object>} provenance_by_id
 */
export function build_spot_check_40_report(sample_doc, provenance_by_id) {
  const merged = JSON.parse(fs.readFileSync(FILE_G3_D4_MERGED_CANDIDATE_200, 'utf8'));
  const cand_by = {};
  for (let m = 0; m < merged.tracks.length; m += 1) {
    cand_by[merged.tracks[m].track_id] = merged.tracks[m];
  }
  const d1_by = load_d1_by_id();
  const ov = JSON.parse(fs.readFileSync(FILE_G3_D2_QUALITY_OVERLAY, 'utf8'));
  const ov_by = {};
  for (let o = 0; o < ov.tracks.length; o += 1) {
    ov_by[ov.tracks[o].track_id] = ov.tracks[o];
  }
  const ev_all = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};

  /** @type {object[]} */
  const rows = [];
  const verdict_counts = {};

  for (let i = 0; i < sample_doc.tracks.length; i += 1) {
    const meta = sample_doc.tracks[i];
    const id = meta.track_id;
    const cand = cand_by[id];
    const d1 = d1_by[id];
    const ev = ev_all[id];
    const rule = ev ? rule_classify_track(ev) : {};
    const review = cand ? auto_review_ai_draft_with_quality(ev, rule, cand) : null;
    const prov = provenance_by_id[id] || null;
    const identity = ev && ev.identity ? ev.identity : {};

    let verdict = VERDICT_INSUFFICIENT;
    let verdict_note_zh =
      'G3-D.5 規則式抽查意見；非人工聽音、非外部 API、不作準確率';

    if (!cand || !d1) {
      verdict = VERDICT_INSUFFICIENT;
    } else if (review && review.status === 'conflict') {
      verdict = VERDICT_CONFLICT;
      verdict_note_zh += '；結構複核 conflict';
    } else if (prov && prov.provenance_status === 'provenance_unverified') {
      if (review && review.quality_status === 'quality_ok') {
        verdict = VERDICT_ADOPT_GAPS;
        verdict_note_zh += '；builder 來源未驗證但品質 v2 ok';
      } else {
        verdict = VERDICT_DEFER;
        verdict_note_zh += '；來源未驗證且 needs_evidence 或 sparse';
      }
    } else if (review && review.quality_status === 'quality_ok') {
      verdict = VERDICT_ADOPT_OK;
    } else if (review && review.quality_status === 'needs_evidence') {
      const sparse =
        !identity.enrichment_cache_complete && !identity.isrc && !identity.album_name;
      if (sparse && cand.confidence_tier !== 'low') {
        verdict = VERDICT_DEFER;
        verdict_note_zh += '；metadata 稀疏卻 medium/high';
      } else {
        verdict = VERDICT_ADOPT_GAPS;
      }
    } else {
      verdict = VERDICT_DEFER;
    }

    if (
      meta.cohort === 'composer_or_artist_heuristic' &&
      cand.genre_profile.primary_genre === 'soundtrack_instrumental' &&
      !has_pure_instrumental(cand) &&
      verdict === VERDICT_ADOPT_OK
    ) {
      verdict = VERDICT_ADOPT_GAPS;
      verdict_note_zh += '；配樂類需保留人聲／語言不確定';
    }

    verdict_counts[verdict] = (verdict_counts[verdict] || 0) + 1;

    rows.push({
      track_id: id,
      cohort: meta.cohort,
      selection_reason_zh: meta.selection_reason_zh,
      metadata: {
        title: identity.title,
        artists: identity.artists,
        album_name: identity.album_name,
        metadata_status: identity.metadata_status,
        enrichment_cache_complete: identity.enrichment_cache_complete,
      },
      d1: {
        primary: d1.genre_profile.primary_genre,
        language: d1.language ? d1.language.value : null,
        tier: d1.confidence_tier,
        reason_zh: d1.reason_zh,
        pure_instrumental_tag: has_pure_instrumental(d1),
      },
      d2: ov_by[id]
        ? { quality_status: ov_by[id].quality_status, issues: ov_by[id].quality_issues }
        : null,
      candidate: {
        primary: cand.genre_profile.primary_genre,
        subgenres: cand.genre_profile.subgenres,
        language: cand.language ? cand.language.value : null,
        tier: cand.confidence_tier,
        reason_zh: cand.reason_zh,
        pure_instrumental_tag: has_pure_instrumental(cand),
        version_uncertainty: cand.version_uncertainty === true,
        source: cand.source,
      },
      auto_review_v2: review
        ? {
            quality_status: review.quality_status,
            quality_issues: review.quality_issues,
            structural_status: review.structural_status,
          }
        : null,
      provenance: prov,
      d5_spot_verdict: verdict,
      d5_note_zh: verdict_note_zh,
    });
  }

  return {
    schema_version: 1,
    disclaimer_zh:
      'D.5 spot 判斷為另一輪 AI/規則抽查意見，不得當獨立外部證據或真實準確率',
    seed: sample_doc.seed,
    track_count: rows.length,
    verdict_counts: verdict_counts,
    tracks: rows,
  };
}

export {
  VERDICT_ADOPT_OK,
  VERDICT_ADOPT_GAPS,
  VERDICT_DEFER,
  VERDICT_CONFLICT,
  VERDICT_INSUFFICIENT,
};
