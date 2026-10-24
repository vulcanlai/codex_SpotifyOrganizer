/**
 * G3-C.1 欄位級任務（100 首 needs_evidence / conflict 全覆蓋）
 */
import { build_field_tasks_for_track } from '../g3_b/field_evidence_tasks.js';
import { auto_review_ai_draft_row } from '../g3_b/auto_review.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { load_g3_b_ai_catalog } from './load_g3_b_ai_catalog.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../../enrichment/external/g1_sample.js';
import {
  TASK_ACTION_HUMAN,
  TASK_STATUS_OPEN,
} from '../g3_b/field_evidence_tasks.js';

function dedupe_tasks(tasks) {
  const seen = {};
  const out = [];
  for (let i = 0; i < tasks.length; i += 1) {
    const key =
      tasks[i].track_id + ':' + tasks[i].field + ':' + String(tasks[i].missing_evidence).slice(0, 48);
    if (seen[key]) {
      continue;
    }
    seen[key] = true;
    out.push(tasks[i]);
  }
  return out;
}

/**
 * 對 auto_review issues 建立通用任務（非全部 requires_human）
 */
function tasks_from_issues(track_id, review, ai_row, evidence_doc) {
  /** @type {object[]} */
  const tasks = [];
  const issues = review.issues || [];
  for (let i = 0; i < issues.length; i += 1) {
    const issue = issues[i];
    const covered = issue.indexOf('演唱語言') >= 0 || issue.indexOf('fixture') >= 0;
    if (covered) {
      continue;
    }
    tasks.push({
      track_id: track_id,
      field: 'classification_review',
      current_suggestion: ai_row.confidence_tier || null,
      missing_evidence: issue,
      evidence_sources: ['g3_auto_review', 'g3_c1'],
      suggested_next_action: review.status === 'conflict' ? TASK_ACTION_HUMAN : 'second_round_ai_inference',
      status: TASK_STATUS_OPEN,
      requires_human: review.status === 'conflict' && track_id === G1_MUST_INCLUDE_LEMON_TREE,
    });
  }
  if (review.status === 'needs_evidence' && !issues.length) {
    tasks.push({
      track_id: track_id,
      field: 'general',
      current_suggestion: ai_row.language && ai_row.language.value,
      missing_evidence: '自動複核 needs_evidence 但未列具體 issue',
      evidence_sources: ['g3_auto_review'],
      suggested_next_action: 'second_round_ai_inference',
      status: TASK_STATUS_OPEN,
      requires_human: false,
    });
  }
  return tasks;
}

/**
 * @param {object} evidence_by_id
 */
export function build_g3_c1_field_evidence_tasks(evidence_by_id) {
  const catalog = load_g3_b_ai_catalog();
  const all = [];

  for (let s = 0; s < catalog.sample_100_ids.length; s += 1) {
    const track_id = catalog.sample_100_ids[s];
    const pack = catalog.by_id[track_id];
    const ev = evidence_by_id[track_id];
    if (!pack || !ev) {
      continue;
    }
    const ai_row = pack.row;
    const rule = rule_classify_track(ev);
    const review = auto_review_ai_draft_row(ev, rule, ai_row);
    if (review.status !== 'needs_evidence' && review.status !== 'conflict') {
      continue;
    }
    const specific = build_field_tasks_for_track(track_id, review, ai_row, ev);
    const generic = tasks_from_issues(track_id, review, ai_row, ev);
    for (let t = 0; t < specific.length; t += 1) {
      all.push(specific[t]);
    }
    for (let g = 0; g < generic.length; g += 1) {
      all.push(generic[g]);
    }
  }

  return dedupe_tasks(all);
}
