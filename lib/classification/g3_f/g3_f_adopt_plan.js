/**
 * G3-F 採用計畫（dry-run 產出 → apply 綁定 plan_hash）
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  FILE_MANUAL_OVERRIDES,
  FILE_AI_REVIEW,
  FILE_AI_REVIEW_V2,
} from '../paths.js';
import { empty_overrides_doc } from '../overrides_store.js';
import {
  G3_F_ADOPT_REGISTRY_SOURCE,
  compute_g3_f_eligibility_rules_fingerprint,
  assert_track_eligible_for_adopt_plan,
} from './g3_f_eligible.js';
import { build_registry_entry_from_candidate } from './g3_f_adopt_registry_store.js';

export const G3_F_ADOPT_PLAN_SCHEMA_VERSION = 1;

function read_json_safe(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * 穩定 JSON 序列化（物件鍵排序）
 * @param {unknown} value
 */
export function stable_stringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    let out = '[';
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) {
        out += ',';
      }
      out += stable_stringify(value[i]);
    }
    return out + ']';
  }
  const keys = Object.keys(value).sort();
  let obj = '{';
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    if (i > 0) {
      obj += ',';
    }
    obj += JSON.stringify(k) + ':' + stable_stringify(value[k]);
  }
  return obj + '}';
}

/**
 * @param {object} registry_doc
 */
export function registry_baseline_fingerprint(registry_doc) {
  const by = (registry_doc && registry_doc.adoptions_by_track_id) || {};
  const ids = Object.keys(by)
    .filter(function (id) {
      return by[id] && by[id].status === 'adopted';
    })
    .sort();
  /** @type {object[]} */
  const rows = [];
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const row = by[id];
    rows.push({
      track_id: id,
      idempotency_key: row.idempotency_key || null,
      source: row.source || null,
    });
  }
  return crypto.createHash('sha256').update(stable_stringify(rows)).digest('hex');
}

/**
 * @param {object} core_plan plan_hash 計算用核心（不含 plan_hash、created_at、報告路徑）
 */
export function compute_plan_hash(core_plan) {
  return crypto.createHash('sha256').update(stable_stringify(core_plan)).digest('hex');
}

/**
 * @param {object} candidate eligible 列
 */
export function plan_track_entry_from_candidate(candidate) {
  const src = G3_F_ADOPT_REGISTRY_SOURCE;
  const idempotency_key = candidate.wave_id + ':' + candidate.track_id + ':' + src;
  return {
    track_id: candidate.track_id,
    title: candidate.title || null,
    wave_id: candidate.wave_id,
    wave_number: candidate.wave_number,
    batch_id: candidate.batch_id,
    staged_path: candidate.staged_path,
    confidence_tier: candidate.confidence_tier,
    inference_source: candidate.inference_source || null,
    inference: candidate.inference || null,
    adopted_classification: candidate.adopted_classification,
    idempotency_key: idempotency_key,
  };
}

/**
 * @param {object} track_entry plan 曲目列
 */
export function candidate_from_plan_track(track_entry) {
  return {
    track_id: track_entry.track_id,
    title: track_entry.title,
    wave_id: track_entry.wave_id,
    wave_number: track_entry.wave_number,
    batch_id: track_entry.batch_id,
    staged_path: track_entry.staged_path,
    confidence_tier: track_entry.confidence_tier,
    inference_source: track_entry.inference_source,
    inference: track_entry.inference,
    adopted_classification: track_entry.adopted_classification,
  };
}

/**
 * @param {object} opts
 */
export function build_g3_f_adopt_plan(opts) {
  const options = opts || {};
  const batch = options.batch || [];
  const registry_doc = options.registry_doc;
  const batch_id =
    options.batch_id ||
    'g3f-plan-' + options.batch_size + 'x' + options.batch_index + '-' + Date.now();
  const eligibility_rules_fingerprint = compute_g3_f_eligibility_rules_fingerprint();
  const registry_baseline = {
    adopted_count: Object.keys(registry_doc.adoptions_by_track_id || {}).filter(function (id) {
      return registry_doc.adoptions_by_track_id[id].status === 'adopted';
    }).length,
    fingerprint: registry_baseline_fingerprint(registry_doc),
  };

  /** @type {object[]} */
  const tracks = [];
  for (let i = 0; i < batch.length; i += 1) {
    tracks.push(plan_track_entry_from_candidate(batch[i]));
  }

  const core_for_hash = {
    schema_version: G3_F_ADOPT_PLAN_SCHEMA_VERSION,
    batch_id: batch_id,
    eligibility_rules_fingerprint: eligibility_rules_fingerprint,
    registry_baseline: registry_baseline,
    selection: {
      batch_size: options.batch_size,
      batch_index: options.batch_index,
      skip_registry_adopted: options.skip_registry_adopted !== false,
    },
    tracks: tracks,
  };

  const plan_hash = compute_plan_hash(core_for_hash);

  return {
    schema_version: G3_F_ADOPT_PLAN_SCHEMA_VERSION,
    batch_id: batch_id,
    created_at: new Date().toISOString(),
    eligibility_rules_fingerprint: eligibility_rules_fingerprint,
    registry_baseline: registry_baseline,
    selection: core_for_hash.selection,
    tracks: tracks,
    plan_hash: plan_hash,
  };
}

/**
 * @param {object} plan
 */
export function verify_plan_hash(plan) {
  if (!plan || plan.schema_version !== G3_F_ADOPT_PLAN_SCHEMA_VERSION) {
    return { ok: false, reason: 'invalid_schema_version' };
  }
  const core = {
    schema_version: plan.schema_version,
    batch_id: plan.batch_id,
    eligibility_rules_fingerprint: plan.eligibility_rules_fingerprint,
    registry_baseline: plan.registry_baseline,
    selection: plan.selection,
    tracks: plan.tracks,
  };
  const expected = compute_plan_hash(core);
  if (expected !== plan.plan_hash) {
    return { ok: false, reason: 'plan_hash_mismatch', expected: expected, actual: plan.plan_hash };
  }
  const ids = plan.tracks.map(function (t) {
    return t.track_id;
  });
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    return { ok: false, reason: 'duplicate_track_id' };
  }
  return { ok: true };
}

function load_ai_review_status_by_id() {
  /** @type {Record<string, string>} */
  const out = {};
  const paths = [FILE_AI_REVIEW_V2, FILE_AI_REVIEW];
  for (let i = 0; i < paths.length; i += 1) {
    const doc = read_json_safe(paths[i]);
    if (!doc || !doc.reviews_by_track_id) {
      continue;
    }
    const keys = Object.keys(doc.reviews_by_track_id);
    for (let k = 0; k < keys.length; k += 1) {
      const id = keys[k];
      const st = doc.reviews_by_track_id[id].status;
      if (st) {
        out[id] = st;
      }
    }
  }
  return out;
}

/**
 * Apply 前完整驗證（不寫入）
 * @param {object} opts
 */
export function validate_plan_for_apply(opts) {
  const options = opts || {};
  const plan = options.plan;
  const registry_doc = options.registry_doc;
  const overrides_doc =
    options.overrides_doc ||
    read_json_safe(FILE_MANUAL_OVERRIDES) ||
    empty_overrides_doc();
  const ai_review = options.ai_review || load_ai_review_status_by_id();
  const staged_map = options.staged_map;

  const hashCheck = verify_plan_hash(plan);
  if (!hashCheck.ok) {
    return { ok: false, phase: 'plan_integrity', detail: hashCheck };
  }

  const mergePreview = evaluate_plan_merge_state(plan, registry_doc);
  if (mergePreview.result === 'already_applied') {
    return mergePreview;
  }
  if (!mergePreview.ok) {
    return mergePreview;
  }

  const current_fp = registry_baseline_fingerprint(registry_doc);
  if (current_fp !== plan.registry_baseline.fingerprint) {
    return {
      ok: false,
      phase: 'registry_baseline',
      detail: {
        reason: 'registry_baseline_mismatch',
        expected: plan.registry_baseline.fingerprint,
        actual: current_fp,
      },
    };
  }

  const currentCount = Object.keys(registry_doc.adoptions_by_track_id || {}).filter(function (id) {
    return registry_doc.adoptions_by_track_id[id].status === 'adopted';
  }).length;
  if (currentCount !== plan.registry_baseline.adopted_count) {
    return {
      ok: false,
      phase: 'registry_baseline',
      detail: {
        reason: 'registry_adopted_count_mismatch',
        expected: plan.registry_baseline.adopted_count,
        actual: currentCount,
      },
    };
  }

  /** @type {object[]} */
  const eligibility_errors = [];
  for (let i = 0; i < plan.tracks.length; i += 1) {
    const t = plan.tracks[i];
    const candidate = candidate_from_plan_track(t);
    const check = assert_track_eligible_for_adopt_plan(candidate, {
      overrides_doc: overrides_doc,
      ai_review: ai_review,
      staged_map: staged_map,
      plan_track: t,
    });
    if (!check.ok) {
      eligibility_errors.push({ track_id: t.track_id, errors: check.errors });
    }
  }
  if (eligibility_errors.length) {
    return { ok: false, phase: 'eligibility', detail: eligibility_errors };
  }

  return mergePreview;
}

/**
 * @param {object} plan
 * @param {object} registry_doc
 */
export function evaluate_plan_merge_state(plan, registry_doc) {
  const by = (registry_doc && registry_doc.adoptions_by_track_id) || {};
  let insert_count = 0;
  let skip_count = 0;
  /** @type {object[]} */
  const conflicts = [];
  let present_count = 0;

  for (let i = 0; i < plan.tracks.length; i += 1) {
    const t = plan.tracks[i];
    const prev = by[t.track_id];
    if (!prev) {
      insert_count += 1;
      continue;
    }
    present_count += 1;
    if (prev.idempotency_key === t.idempotency_key) {
      skip_count += 1;
      continue;
    }
    conflicts.push({
      track_id: t.track_id,
      reason: 'existing_different_idempotency_key',
      existing_key: prev.idempotency_key,
      plan_key: t.idempotency_key,
    });
  }

  if (conflicts.length) {
    return {
      ok: false,
      phase: 'merge',
      result: 'conflict',
      insert_count: insert_count,
      skip_count: skip_count,
      conflict_count: conflicts.length,
      conflicts: conflicts,
    };
  }

  if (present_count > 0 && present_count < plan.tracks.length) {
    return {
      ok: false,
      phase: 'merge',
      result: 'partial_applied',
      insert_count: insert_count,
      skip_count: skip_count,
      conflict_count: 0,
      detail: 'plan 內部分 track 已採用、部分未採用，禁止繼續 apply',
    };
  }

  if (insert_count === 0 && skip_count === plan.tracks.length) {
    return {
      ok: true,
      result: 'already_applied',
      insert_count: 0,
      skip_count: skip_count,
      conflict_count: 0,
    };
  }

  if (insert_count === plan.tracks.length) {
    return {
      ok: true,
      result: 'ready',
      insert_count: insert_count,
      skip_count: 0,
      conflict_count: 0,
    };
  }

  return {
    ok: false,
    phase: 'merge',
    result: 'unexpected_state',
    insert_count: insert_count,
    skip_count: skip_count,
    conflict_count: 0,
  };
}

/**
 * @param {string} plan_path
 */
export function load_g3_f_adopt_plan_file(plan_path) {
  const abs = path.isAbsolute(plan_path) ? plan_path : path.join(process.cwd(), plan_path);
  if (!fs.existsSync(abs)) {
    throw new Error('找不到 apply plan：' + abs);
  }
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

/**
 * @param {object} plan
 * @param {string} dir
 */
export function write_g3_f_adopt_plan_files(plan, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const plan_path = path.join(dir, 'apply-plan.json');
  fs.writeFileSync(plan_path, JSON.stringify(plan, null, 2) + '\n', 'utf8');
  return { plan_path: plan_path, reports_dir: dir };
}
