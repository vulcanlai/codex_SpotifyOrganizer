/**
 * 品質驗證統計（抽樣 20 首，非全庫準確率）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../atomic_json.js';
import {
  FILE_PHASE_F_REPORT,
  PHASE_F_AUDIT_ID,
  PHASE_F_SCHEMA_VERSION,
  VERDICT_CORRECT,
  VERDICT_PARTIAL,
  VERDICT_INCORRECT,
  VERDICT_UNDECIDABLE,
  VERDICT_UNSET,
} from './quality_audit_paths.js';
import { load_phase_f_sample } from './phase_f_sample.js';
import { load_quality_verification } from './quality_audit_store.js';
import { compute_confidence_tier } from './confidence_tier.js';
import { genre_profile_from_ai_candidate } from './genre_profile.js';
import { FILE_CLASSIFICATION_INDEX } from './paths.js';
import { FILE_PHASE_E_CANDIDATES_IMPORTED } from './ai_test_batches.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function inc(map, key) {
  const k = key || 'unknown';
  map[k] = (map[k] || 0) + 1;
}

/**
 * @param {object} [opts]
 */
export function build_quality_audit_report(opts) {
  const options = opts || {};
  const sample = options.sample_doc || load_phase_f_sample();
  if (!sample || !sample.track_ids) {
    throw new Error('尚未建立 phase-f 抽樣');
  }
  const verification = options.verification_doc || load_quality_verification();
  const imported = read_json(FILE_PHASE_E_CANDIDATES_IMPORTED);
  const index = read_json(FILE_CLASSIFICATION_INDEX);
  const tracks_by_id = (index && index.tracks_by_id) || {};
  const reviews = verification.reviews_by_track_id || {};

  const verdict_counts = {
    correct: 0,
    partial: 0,
    incorrect: 0,
    undecidable: 0,
    unset: 0,
  };
  const tier_verdicts = {
    high: { correct: 0, partial: 0, incorrect: 0, undecidable: 0, reviewed: 0 },
    medium: { correct: 0, partial: 0, incorrect: 0, undecidable: 0, reviewed: 0 },
    low: { correct: 0, partial: 0, incorrect: 0, undecidable: 0, reviewed: 0 },
  };
  const pop_verdicts = {
    pop: { correct: 0, partial: 0, incorrect: 0, undecidable: 0, reviewed: 0 },
    non_pop: { correct: 0, partial: 0, incorrect: 0, undecidable: 0, reviewed: 0 },
  };
  const unknown_verdicts = {
    unknown_primary: { correct: 0, partial: 0, incorrect: 0, undecidable: 0, reviewed: 0 },
  };
  const wrong_dimension_counts = {};

  let reviewed_judged = 0;

  for (let i = 0; i < sample.track_ids.length; i += 1) {
    const id = sample.track_ids[i];
    const rev = reviews[id];
    const verdict = rev && rev.verdict ? rev.verdict : VERDICT_UNSET;
    inc(verdict_counts, verdict);

    let cand = null;
    if (imported && imported.candidates) {
      for (let c = 0; c < imported.candidates.length; c += 1) {
        if (imported.candidates[c].spotify_id === id) {
          cand = imported.candidates[c];
          break;
        }
      }
    }
    const row = tracks_by_id[id] || null;
    const tier = cand
      ? compute_confidence_tier({ candidate: cand, index_row: row }).tier
      : 'low';
    const gp = cand ? genre_profile_from_ai_candidate(cand) : null;
    const is_pop = gp && gp.primary_genre === 'pop';
    const is_unknown = gp && gp.primary_genre === 'unknown';

    if (verdict !== VERDICT_UNSET) {
      if (tier_verdicts[tier]) {
        tier_verdicts[tier].reviewed += 1;
        if (tier_verdicts[tier][verdict] != null) {
          tier_verdicts[tier][verdict] += 1;
        }
      }
      const pop_key = is_pop ? 'pop' : 'non_pop';
      pop_verdicts[pop_key].reviewed += 1;
      if (pop_verdicts[pop_key][verdict] != null) {
        pop_verdicts[pop_key][verdict] += 1;
      }
      if (is_unknown) {
        unknown_verdicts.unknown_primary.reviewed += 1;
        if (unknown_verdicts.unknown_primary[verdict] != null) {
          unknown_verdicts.unknown_primary[verdict] += 1;
        }
      }
      if (verdict !== VERDICT_UNDECIDABLE) {
        reviewed_judged += 1;
      }
      if (rev && rev.wrong_dimensions) {
        for (let w = 0; w < rev.wrong_dimensions.length; w += 1) {
          inc(wrong_dimension_counts, rev.wrong_dimensions[w]);
        }
      }
    }
  }

  const reviewed_total =
    verdict_counts.correct +
    verdict_counts.partial +
    verdict_counts.incorrect +
    verdict_counts.undecidable;

  const has_human_verification = reviewed_total > 0;
  const rates = {
    has_human_verification,
    accuracy_note: has_human_verification
      ? '比例僅針對已驗證且可判斷（不含 undecidable）之抽樣子集；不得外推至 100 首或全庫。'
      : '尚無人工驗證結果',
    denominator_judged: reviewed_judged,
    correct_pct: null,
    partial_pct: null,
    incorrect_pct: null,
    undecidable_pct: null,
  };

  if (reviewed_judged > 0) {
    rates.correct_pct = Math.round((verdict_counts.correct / reviewed_judged) * 1000) / 10;
    rates.partial_pct = Math.round((verdict_counts.partial / reviewed_judged) * 1000) / 10;
    rates.incorrect_pct = Math.round((verdict_counts.incorrect / reviewed_judged) * 1000) / 10;
  }
  if (reviewed_total > 0) {
    rates.undecidable_pct =
      Math.round((verdict_counts.undecidable / reviewed_total) * 1000) / 10;
  }

  const report = {
    schema_version: PHASE_F_SCHEMA_VERSION,
    audit_id: PHASE_F_AUDIT_ID,
    generated_at: new Date().toISOString(),
    sample_id: sample.sample_id,
    sample_track_count: sample.track_count,
    source_test_batch_id: sample.source_test_batch_id,
    stratified_sample_note:
      '20 首為刻意分層抽樣，整體比例不是 phase-e 100 首的無偏估計，亦不代表 7,759 首全庫準確率。',
    verification_progress: {
      reviewed: reviewed_total,
      pending: sample.track_ids.length - reviewed_total,
      total: sample.track_ids.length,
    },
    verdict_counts,
    rates,
    by_confidence_tier: tier_verdicts,
    by_pop: pop_verdicts,
    unknown_primary_verdicts: unknown_verdicts,
    common_wrong_dimensions: wrong_dimension_counts,
    sample_stratum_actual: sample.actual_distribution || null,
  };

  if (options.write !== false) {
    write_json_atomic(FILE_PHASE_F_REPORT, report);
  }
  return report;
}
