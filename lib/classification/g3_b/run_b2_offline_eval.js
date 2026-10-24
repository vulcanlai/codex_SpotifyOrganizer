/**
 * G3-B.2 三十首離線重新評估（不呼叫 AI、不寫 G3-B.1）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { build_g3_evidence_index } from '../g3_evidence/build_evidence_index.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { ensure_g3_b_sample } from './sample.js';
import { rule_classify_track } from './rule_classify.js';
import { resolve_classification_queue_state, QUEUE_STATE } from './queue_state.js';
import { auto_review_ai_draft_batch } from './auto_review.js';
import { KNOWN_VOCAL_LANGUAGE_FIXTURES } from './language_evidence.js';
import {
  G3_B2_TRIAL_DIR,
  FILE_G3_B2_QUEUE_STATES,
  FILE_G3_B2_AI_PENDING,
  FILE_G3_B2_REEVAL_SUMMARY,
  FILE_G3_B2_AUTO_REVIEW,
  FILE_G3_B2_LANGUAGE_CORRECTIONS,
  FILE_G3_B2_EXCLUDED_COMPARE,
  FILE_G3_B1_AI_DRAFT_READONLY,
  FILE_G3_B1_AI_PENDING_READONLY,
} from './paths_b2.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function load_evidence_index() {
  const path = file_g3_evidence_index();
  if (!fs.existsSync(path)) {
    build_g3_evidence_index({ write: true });
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function run_g3_b2_offline_eval(opts) {
  const options = opts || {};
  const write = options.write !== false;

  if (write && !fs.existsSync(G3_B2_TRIAL_DIR)) {
    fs.mkdirSync(G3_B2_TRIAL_DIR, { recursive: true });
  }

  const sample = ensure_g3_b_sample({ write: false });
  const evidence_index = load_evidence_index();
  const g3b1_draft = read_json(FILE_G3_B1_AI_DRAFT_READONLY);
  const g3b1_pending = read_json(FILE_G3_B1_AI_PENDING_READONLY);

  const g3b1_by_id = {};
  if (g3b1_draft && g3b1_draft.tracks) {
    for (let i = 0; i < g3b1_draft.tracks.length; i += 1) {
      g3b1_by_id[g3b1_draft.tracks[i].track_id] = g3b1_draft.tracks[i];
    }
  }

  const old_pending_set = {};
  (g3b1_pending && g3b1_pending.pending ? g3b1_pending.pending : []).forEach(function (p) {
    old_pending_set[p.track_id] = true;
  });

  const queue_rows = [];
  const generation_pending = [];
  const state_counts = {};
  const rule_by_id = {};
  const evidence_by_id = evidence_index.tracks;

  for (let i = 0; i < sample.track_ids.length; i += 1) {
    const id = sample.track_ids[i];
    const ev = evidence_index.tracks[id];
    if (!ev) {
      continue;
    }
    const rule = rule_classify_track(ev);
    rule_by_id[id] = rule;
    const q = resolve_classification_queue_state(ev, rule, {
      g3b1_ai_row: g3b1_by_id[id] || null,
      g3b2_processed_ids: g3b1_by_id,
    });
    state_counts[q.queue_state] = (state_counts[q.queue_state] || 0) + 1;
    queue_rows.push({
      track_id: id,
      title: ev.identity.title,
      classification_kind: rule.classification_kind,
      primary_genre: rule.genre_profile.primary_genre,
      queue_state: q.queue_state,
      ai_pending: q.ai_pending,
      needs_ai_generation: q.needs_ai_generation,
      reason_zh: q.reason_zh,
      retry_when: q.retry_when || null,
    });
    if (q.needs_ai_generation) {
      generation_pending.push({
        track_id: id,
        title: ev.identity.title,
        queue_state: q.queue_state,
        reason_zh: q.reason_zh,
      });
    }
  }

  const formerly_excluded = queue_rows.filter(function (row) {
    const was_unknown_not_old =
      row.primary_genre === 'unknown' && !old_pending_set[row.track_id];
    return was_unknown_not_old;
  });

  const re_admitted = formerly_excluded.filter(function (row) {
    return row.queue_state === QUEUE_STATE.PENDING_AI;
  });

  let auto_review = { results: [], counts: {} };
  if (g3b1_draft && g3b1_draft.tracks) {
    auto_review = auto_review_ai_draft_batch(
      g3b1_draft.tracks,
      evidence_by_id,
      rule_by_id
    );
  }

  const summary = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    sample_id: sample.sample_id,
    comparison: {
      g3_b1_ai_pending_count: Object.keys(old_pending_set).length,
      g3_b2_ai_generation_pending_count: generation_pending.length,
      delta_pending: generation_pending.length - Object.keys(old_pending_set).length,
    },
    queue_state_counts: state_counts,
    formerly_unknown_not_in_b1_pending: formerly_excluded.length,
    formerly_excluded_re_admitted_as_pending_ai: re_admitted.length,
    has_ai_suggestion_skip_regen: state_counts[QUEUE_STATE.HAS_AI_SUGGESTION] || 0,
    needs_data: state_counts[QUEUE_STATE.NEEDS_DATA] || 0,
    needs_human_decision_auto_review: auto_review.counts.needs_human_decision || 0,
    needs_supplemental_evidence_auto_review: auto_review.counts.needs_supplemental_evidence || 0,
    auto_review_counts: auto_review.counts,
    summary_zh: [
      'G3-B.2 新 AI 生成佇列 ' +
        generation_pending.length +
        ' 首（G3-B.1 為 ' +
        Object.keys(old_pending_set).length +
        ' 首）',
      '原 17 首 unknown 未進 B1 佇列中，重新納入 pending_ai：' + re_admitted.length + ' 首',
      '已有 v2 候選不重複生成：' + (state_counts[QUEUE_STATE.HAS_AI_SUGGESTION] || 0) + ' 首',
    ],
  };

  const language_corrections = {
    schema_version: 1,
    note: '獨立修正紀錄；不覆寫 G3-B.1 ai-classification-draft.json；不宣稱為 MB 演唱語言查證',
    fixtures: Object.keys(KNOWN_VOCAL_LANGUAGE_FIXTURES).map(function (id) {
      return KNOWN_VOCAL_LANGUAGE_FIXTURES[id];
    }),
  };

  if (write) {
    write_json_atomic(FILE_G3_B2_QUEUE_STATES, {
      schema_version: 1,
      generated_at: summary.generated_at,
      tracks: queue_rows,
    });
    write_json_atomic(FILE_G3_B2_AI_PENDING, {
      schema_version: 1,
      generated_at: summary.generated_at,
      pending: generation_pending,
    });
    write_json_atomic(FILE_G3_B2_REEVAL_SUMMARY, summary);
    write_json_atomic(FILE_G3_B2_AUTO_REVIEW, {
      schema_version: 1,
      generated_at: summary.generated_at,
      source_draft: 'g3-b-trial-30/ai-classification-draft.json（唯讀）',
      results: auto_review.results,
      counts: auto_review.counts,
    });
    write_json_atomic(FILE_G3_B2_LANGUAGE_CORRECTIONS, language_corrections);
    write_json_atomic(FILE_G3_B2_EXCLUDED_COMPARE, {
      schema_version: 1,
      generated_at: summary.generated_at,
      formerly_excluded: formerly_excluded,
      re_admitted: re_admitted,
    });
  }

  return {
    summary: summary,
    queue_rows: queue_rows,
    generation_pending: generation_pending,
    auto_review: auto_review,
  };
}
