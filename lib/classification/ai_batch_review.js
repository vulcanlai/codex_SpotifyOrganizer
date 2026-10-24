/**
 * AI 測試批次人工審核（v2 30 / phase-e-100，單次上限 30）
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  AI_CANDIDATE_VERSION_V2,
  BATCH_REVIEW_MAX_DEFAULT,
} from './paths.js';
import {
  get_test_batch_config,
  normalize_test_batch_id,
} from './ai_test_batches.js';
import { write_json_atomic } from '../atomic_json.js';
import { load_ai_review_at } from './ai_review_store.js';
import {
  apply_ai_review_action,
  normalize_review_action,
  target_status_for_action,
} from './ai_review_apply.js';
import { load_classification_settings } from './preview_settings.js';
import { build_formal_classification_state } from './formal_state_build.js';
import { build_classification_index } from './build_index.js';
import {
  REVIEW_ACCEPTED,
  REVIEW_MODIFIED,
  REVIEW_REJECTED,
  REVIEW_PENDING,
} from './ai_review_store.js';

export const BATCH_OPS_SCHEMA_VERSION = 1;

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function find_candidate(doc, id) {
  const list = doc && doc.candidates ? doc.candidates : [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].spotify_id === id) {
      return list[i];
    }
  }
  return null;
}

export function empty_batch_ops_doc() {
  return {
    schema_version: BATCH_OPS_SCHEMA_VERSION,
    updated_at: null,
    candidate_version: AI_CANDIDATE_VERSION_V2,
    operations: [],
  };
}

export function load_batch_operations_at(file_path) {
  if (!fs.existsSync(file_path)) {
    return empty_batch_ops_doc();
  }
  const doc = JSON.parse(fs.readFileSync(file_path, 'utf8'));
  if (!doc.operations) {
    doc.operations = [];
  }
  return doc;
}

export function save_batch_operations_at(file_path, doc) {
  doc.schema_version = BATCH_OPS_SCHEMA_VERSION;
  doc.updated_at = new Date().toISOString();
  doc.candidate_version = AI_CANDIDATE_VERSION_V2;
  write_json_atomic(file_path, doc);
  return doc;
}

function operation_fingerprint(test_batch_id, candidate_version, action, track_ids) {
  const sorted = track_ids.slice().sort();
  const raw =
    String(test_batch_id) +
    '|' +
    String(candidate_version) +
    '|' +
    normalize_review_action(action) +
    '|' +
    sorted.join(',');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function find_idempotent_operation(ops_doc, client_operation_id, fingerprint) {
  const ops = ops_doc.operations || [];
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    if (client_operation_id && op.client_operation_id === client_operation_id) {
      return op;
    }
    if (op.fingerprint === fingerprint && op.status === 'completed') {
      return op;
    }
  }
  return null;
}

function review_status_matches_action(current_status, action) {
  const target = target_status_for_action(action);
  if (!target) {
    return false;
  }
  if (target === REVIEW_ACCEPTED) {
    return current_status === REVIEW_ACCEPTED || current_status === REVIEW_MODIFIED;
  }
  return current_status === target;
}

/**
 * @param {object} input
 */
export function plan_batch_review(input) {
  const settings = input.settings || load_classification_settings();
  const max_n = settings.batch_review_max || BATCH_REVIEW_MAX_DEFAULT;
  const version = input.candidate_version || AI_CANDIDATE_VERSION_V2;
  const test_batch = normalize_test_batch_id(
    input.test_batch_id || settings.active_test_batch || 'v2-sample-30'
  );
  const cfg = get_test_batch_config(test_batch);
  const action = input.action;
  const track_ids = input.track_ids || [];

  const errors = [];
  if (version !== AI_CANDIDATE_VERSION_V2) {
    errors.push('批次審核僅支援 v2 schema 候選');
  }
  const target = target_status_for_action(action);
  if (!target) {
    errors.push('未知 action');
  }
  if (!track_ids.length) {
    errors.push('未選取任何曲目');
  }
  if (track_ids.length > max_n) {
    errors.push('超過單次上限 ' + max_n + ' 首');
  }

  const sample = read_json(cfg.sample_file);
  const candidates = read_json(cfg.candidates_imported_file);
  if (!sample) {
    errors.push('尚未建立測試樣本：' + test_batch);
  }
  if (!candidates || !candidates.candidates || !candidates.candidates.length) {
    errors.push('尚未匯入 AI 候選：' + test_batch);
  }

  if (errors.length) {
    return { ok: false, errors, preview: null };
  }

  const sample_set = {};
  for (let i = 0; i < sample.track_ids.length; i += 1) {
    sample_set[sample.track_ids[i]] = true;
  }

  const review = load_ai_review_at(cfg.review_file);
  const per_track = [];
  let would_apply = 0;
  let skipped = 0;
  let failed = 0;

  for (let t = 0; t < track_ids.length; t += 1) {
    const id = track_ids[t];
    let reason = null;
    if (!sample_set[id]) {
      reason = '不在目前測試批次樣本';
      failed += 1;
      per_track.push({ spotify_id: id, outcome: 'failed', reason });
      continue;
    }
    const cand = find_candidate(candidates, id);
    if (!cand) {
      reason = '找不到 AI 候選';
      failed += 1;
      per_track.push({ spotify_id: id, outcome: 'failed', reason });
      continue;
    }
    const rev = review.reviews_by_track_id[id] || { status: REVIEW_PENDING };
    const cur = rev.status || REVIEW_PENDING;
    if (rev.candidate_version != null && rev.candidate_version !== AI_CANDIDATE_VERSION_V2) {
      reason = '審核紀錄版本不符';
      skipped += 1;
      per_track.push({ spotify_id: id, outcome: 'skipped', reason });
      continue;
    }
    if (review_status_matches_action(cur, action)) {
      reason = '已是目標狀態';
      skipped += 1;
      per_track.push({ spotify_id: id, outcome: 'skipped', reason });
      continue;
    }
    would_apply += 1;
    per_track.push({ spotify_id: id, outcome: 'would_apply', reason: null });
  }

  const fingerprint = operation_fingerprint(test_batch, version, action, track_ids);

  return {
    ok: true,
    errors: [],
    preview: {
      test_batch_id: test_batch,
      candidate_version: version,
      action: normalize_review_action(action),
      track_count: track_ids.length,
      max_allowed: max_n,
      would_apply,
      skipped,
      failed,
      per_track,
      fingerprint,
    },
  };
}

/**
 * @param {object} input
 */
export function execute_batch_review(input) {
  const dry_run = input.dry_run === true;
  const client_operation_id = input.client_operation_id || null;
  const plan = plan_batch_review(input);
  if (!plan.ok) {
    return { ok: false, errors: plan.errors };
  }

  const preview = plan.preview;
  if (dry_run) {
    return { ok: true, dry_run: true, preview, result: null };
  }

  const test_batch = preview.test_batch_id;
  const cfg = get_test_batch_config(test_batch);
  const ops_doc = load_batch_operations_at(cfg.batch_operations_file);
  const existing = find_idempotent_operation(
    ops_doc,
    client_operation_id,
    preview.fingerprint
  );
  if (existing && existing.result) {
    return {
      ok: true,
      idempotent: true,
      preview,
      result: existing.result,
      operation_id: existing.operation_id,
    };
  }

  const candidates = read_json(cfg.candidates_imported_file);
  const review = load_ai_review_at(cfg.review_file);
  const now = new Date().toISOString();
  let success = 0;
  let skipped = 0;
  let failed = 0;
  const details = [];

  for (let i = 0; i < preview.per_track.length; i += 1) {
    const row = preview.per_track[i];
    if (row.outcome !== 'would_apply') {
      if (row.outcome === 'skipped') {
        skipped += 1;
      } else {
        failed += 1;
      }
      details.push(row);
      continue;
    }
    const id = row.spotify_id;
    const cand = find_candidate(candidates, id);
    const applied = apply_ai_review_action({
      track_id: id,
      action: input.action,
      version: AI_CANDIDATE_VERSION_V2,
      candidate: cand,
      review_doc: review,
      review_path: cfg.review_file,
      source: input.source || 'classify:batch',
      now,
      persist: true,
    });
    if (!applied.ok) {
      failed += 1;
      details.push({
        spotify_id: id,
        outcome: 'failed',
        reason: applied.error || applied.code,
      });
      continue;
    }
    success += 1;
    details.push({ spotify_id: id, outcome: 'success', reason: null });
  }

  let built = null;
  if (success > 0) {
    built = build_classification_index();
    build_formal_classification_state(built.index_doc, { write: true });
  }

  const result = {
    success,
    skipped,
    failed,
    total: preview.track_count,
    details,
  };

  const operation_id = crypto.randomBytes(8).toString('hex');
  ops_doc.operations.push({
    operation_id,
    client_operation_id,
    fingerprint: preview.fingerprint,
    test_batch_id: test_batch,
    candidate_version: AI_CANDIDATE_VERSION_V2,
    action: preview.action,
    track_ids: input.track_ids.slice().sort(),
    created_at: now,
    status: 'completed',
    result,
  });
  save_batch_operations_at(cfg.batch_operations_file, ops_doc);

  return {
    ok: true,
    idempotent: false,
    preview,
    result,
    operation_id,
    summary: built ? built.summary_doc : null,
  };
}
