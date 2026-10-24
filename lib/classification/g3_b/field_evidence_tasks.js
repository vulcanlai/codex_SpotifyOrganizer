/**
 * 欄位級補證據任務（G3-B.3）
 */
import { G1_MUST_INCLUDE_LEMON_TREE } from '../../enrichment/external/g1_sample.js';
import { get_known_vocal_language_fixture } from './language_evidence.js';
import { REVIEW_NEEDS_EVIDENCE, REVIEW_CONFLICT } from './auto_review.js';

export const TASK_STATUS_OPEN = 'open';
export const TASK_ACTION_AUTO = 'auto_from_existing_data';
export const TASK_ACTION_EXTERNAL = 'future_external_lookup';
export const TASK_ACTION_AI_ROUND2 = 'second_round_ai_inference';
export const TASK_ACTION_HUMAN = 'human_decision';

/**
 * @param {object} review auto_review result
 * @param {object} ai_row g3b1 draft row
 * @param {object} evidence_doc
 */
export function build_field_tasks_for_track(track_id, review, ai_row, evidence_doc) {
  /** @type {object[]} */
  const tasks = [];
  if (!review || !ai_row) {
    return tasks;
  }

  const title = evidence_doc.identity && evidence_doc.identity.title;

  if (review.status === REVIEW_NEEDS_EVIDENCE || review.status === REVIEW_CONFLICT) {
    const issues = review.issues || [];
    for (let i = 0; i < issues.length; i += 1) {
      const issue = issues[i];
      if (issue.indexOf('演唱語言') >= 0 || issue.indexOf('fixture') >= 0) {
        tasks.push(make_vocal_language_task(track_id, ai_row, evidence_doc, issue, review));
      } else if (issue.indexOf('version_uncertainty') >= 0 || issue.indexOf('Live') >= 0) {
        tasks.push({
          track_id: track_id,
          field: 'recording_version',
          current_suggestion: ai_row.version_uncertainty ? 'marked_uncertain' : 'not_marked',
          missing_evidence: 'Live/Remix 版本未在草稿標記',
          evidence_sources: ['title_parse', 'g3_b1_draft'],
          suggested_next_action: TASK_ACTION_AI_ROUND2,
          status: TASK_STATUS_OPEN,
          requires_human: false,
        });
      } else if (issue.indexOf('藝人國籍') >= 0) {
        tasks.push({
          track_id: track_id,
          field: 'vocal_language',
          current_suggestion: ai_row.language,
          missing_evidence: '語言推論疑似依藝人國籍',
          evidence_sources: ['g3_b1_draft.language.evidence'],
          suggested_next_action: TASK_ACTION_AI_ROUND2,
          status: TASK_STATUS_OPEN,
          requires_human: false,
        });
      } else if (issue.indexOf('vocal_verification_status') >= 0) {
        tasks.push({
          track_id: track_id,
          field: 'vocal_language',
          current_suggestion: ai_row.language,
          missing_evidence: '缺少 vocal_verification_status 標記',
          evidence_sources: ['g3_b1_draft'],
          suggested_next_action: TASK_ACTION_AUTO,
          status: TASK_STATUS_OPEN,
          requires_human: false,
        });
      }
    }
  }

  if (title && /live|remix/i.test(title) && ai_row.version_uncertainty !== true) {
    const has_version_task = tasks.some(function (t) {
      return t.field === 'recording_version';
    });
    if (!has_version_task) {
      tasks.push({
        track_id: track_id,
        field: 'recording_version',
        current_suggestion: { version_uncertainty: false },
        missing_evidence: '標題含 Live/Remix 但未標 version_uncertainty',
        evidence_sources: ['identity.title'],
        suggested_next_action: TASK_ACTION_AUTO,
        status: TASK_STATUS_OPEN,
        requires_human: false,
      });
    }
  }

  const v = evidence_doc.verification_status || {};
  if (
    v.g2_1_offline &&
    v.g2_1_offline.artist_match_status === 'unverified_cross_script'
  ) {
    tasks.push({
      track_id: track_id,
      field: 'artist_identity',
      current_suggestion: v.g2_1_offline.artist_match_status,
      missing_evidence: '跨語系藝人名稱尚未核實',
      evidence_sources: ['g2_1_offline'],
      suggested_next_action: TASK_ACTION_EXTERNAL,
      status: TASK_STATUS_OPEN,
      requires_human: false,
    });
  }

  if (
    has_primary_unknown(ai_row) &&
    review.status === REVIEW_NEEDS_EVIDENCE
  ) {
    tasks.push({
      track_id: track_id,
      field: 'genre',
      current_suggestion: ai_row.genre_profile,
      missing_evidence: '曲風證據不足',
      evidence_sources: ['g3_b1_draft', 'auto_review'],
      suggested_next_action: TASK_ACTION_AI_ROUND2,
      status: TASK_STATUS_OPEN,
      requires_human: false,
    });
  }

  return dedupe_tasks(tasks);
}

function has_primary_unknown(row) {
  const gp = row.genre_profile || {};
  return !gp.primary_genre || gp.primary_genre === 'unknown';
}

function make_vocal_language_task(track_id, ai_row, evidence_doc, issue, review) {
  const fixture = get_known_vocal_language_fixture(track_id);
  const is_lemon = track_id === G1_MUST_INCLUDE_LEMON_TREE;

  const task = {
    track_id: track_id,
    field: 'vocal_language',
    current_suggestion: ai_row.language || null,
    missing_evidence: issue,
    evidence_sources: ['g3_b1_draft', 'auto_review_g3_b2'],
    status: TASK_STATUS_OPEN,
    requires_human: review.status === REVIEW_CONFLICT && is_lemon,
  };

  if (is_lemon && fixture) {
    task.preserve_g3_b1_original = {
      language_value: ai_row.language && ai_row.language.value,
      note: '保留 G3-B.1 原始 AI 語言建議，不覆寫草稿檔',
    };
    task.project_fixture_hint = {
      vocal_language: fixture.vocal_language,
      source_type: fixture.source_type,
      does_not_claim_mb_verification: true,
      not_formal_human_confirmation: true,
    };
    task.genre_preserved = ai_row.genre_profile || null;
    task.suggested_next_action = TASK_ACTION_HUMAN;
    task.missing_evidence =
      'G3-B.1 英文 vs 專案 fixture 國語（測試用）；需欄位級修正，非整首重分類';
  } else if (review.status === REVIEW_CONFLICT) {
    task.suggested_next_action = TASK_ACTION_HUMAN;
    task.requires_human = true;
  } else {
    task.suggested_next_action = TASK_ACTION_AI_ROUND2;
    task.requires_human = false;
  }

  return task;
}

function dedupe_tasks(tasks) {
  const seen = {};
  const out = [];
  for (let i = 0; i < tasks.length; i += 1) {
    const key = tasks[i].track_id + ':' + tasks[i].field + ':' + tasks[i].missing_evidence.slice(0, 40);
    if (seen[key]) {
      continue;
    }
    seen[key] = true;
    out.push(tasks[i]);
  }
  return out;
}

/**
 * @param {object[]} auto_review_results
 * @param {Record<string, object>} g3b1_by_id
 * @param {Record<string, object>} evidence_by_id
 */
export function build_all_field_evidence_tasks(auto_review_results, g3b1_by_id, evidence_by_id) {
  const all = [];
  for (let i = 0; i < auto_review_results.length; i += 1) {
    const row = auto_review_results[i];
    const ai = g3b1_by_id[row.track_id];
    const ev = evidence_by_id[row.track_id];
    if (!ai || !ev) {
      continue;
    }
    if (row.review.status !== REVIEW_NEEDS_EVIDENCE && row.review.status !== REVIEW_CONFLICT) {
      continue;
    }
    const tasks = build_field_tasks_for_track(row.track_id, row.review, ai, ev);
    for (let t = 0; t < tasks.length; t += 1) {
      all.push(tasks[t]);
    }
  }
  return all;
}
