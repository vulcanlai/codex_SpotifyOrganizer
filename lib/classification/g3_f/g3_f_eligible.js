/**
 * G3-F 採用 eligible 候選（與 preview／registry 共用）
 */
import {
  FILE_CLASSIFICATION_INDEX,
  FILE_MANUAL_OVERRIDES,
  FILE_AI_REVIEW,
  FILE_AI_REVIEW_V2,
} from '../paths.js';
import { empty_overrides_doc } from '../overrides_store.js';
import { normalize_genre_profile, validate_genre_profile } from '../genre_profile.js';
import { validate_primary_subgenres } from '../g3_b/genre_subgenre_validate.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import { LANGUAGE_VALUES } from '../dimensions.js';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  load_deduped_g3_f_staged_map,
  inference_to_adopt_patch,
  G3_F_ADOPT_EXCLUDE_OST,
  G3_F_ADOPT_EXCLUDE_LOW_DRAFT,
} from './g3_f_adopt_preview.js';
import { load_g3_f_adopt_registry } from './g3_f_adopt_registry_store.js';
import { manual_override_blocks_g3_f_genre_adopt } from './manual_override_adopt_guard.js';

export const G3_F_ADOPT_REGISTRY_SOURCE = 'g3_f_adopt:registry:v1';

/** eligibility 規則版本（變更排除邏輯時必須 bump） */
export const G3_F_ELIGIBILITY_RULES_VERSION = 'g3_f_eligible_rules:v2';

export function compute_g3_f_eligibility_rules_fingerprint() {
  const payload = {
    version: G3_F_ELIGIBILITY_RULES_VERSION,
    tier_required: 'high',
    ai_review_exclude: ['pending', 'accepted', 'modified', 'rejected'],
    ost_blocklist: [...G3_F_ADOPT_EXCLUDE_OST].sort(),
    low_draft_blocklist: [...G3_F_ADOPT_EXCLUDE_LOW_DRAFT].sort(),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

const AI_REVIEW_EXCLUDE_STATUSES = new Set([
  'pending',
  'accepted',
  'modified',
  'rejected',
]);

function read_json_safe(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
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

function validate_adopt_patch(patch) {
  const gp = normalize_genre_profile(patch.genre_profile);
  const gp_errors = validate_genre_profile(gp);
  const sub = validate_primary_subgenres(gp.primary_genre, gp.subgenres || []);
  const lang_ok =
    patch.language == null || LANGUAGE_VALUES.indexOf(patch.language) >= 0;
  return {
    ok:
      gp_errors.length === 0 &&
      sub.ok &&
      lang_ok &&
      gp.primary_genre !== GENRE_PRIMARY_UNKNOWN,
    genre_profile_errors: gp_errors,
    subgenre_check: sub,
    language_ok: lang_ok,
    normalized_genre_profile: gp,
  };
}

/**
 * @param {object} [opts]
 */
export function compute_g3_f_eligible_candidates(opts) {
  const options = opts || {};
  const adopt_source = options.adopt_source || G3_F_ADOPT_REGISTRY_SOURCE;
  const staged_map = options.staged_map || load_deduped_g3_f_staged_map();
  const overrides_doc =
    options.overrides_doc ||
    read_json_safe(FILE_MANUAL_OVERRIDES) ||
    empty_overrides_doc();
  const ai_review = options.ai_review || load_ai_review_status_by_id();
  const exclude_ost = new Set(G3_F_ADOPT_EXCLUDE_OST);
  const exclude_low_draft = new Set(G3_F_ADOPT_EXCLUDE_LOW_DRAFT);

  /** @type {Record<string, number>} */
  const exclusion_counts = {
    total_staged_deduped: staged_map.size,
    not_high_tier: 0,
    primary_unknown: 0,
    human_locked: 0,
    manual_override_blocks_genre: 0,
    ai_review_any: 0,
    low_tier_blocklist: 0,
    ost_draft_blocklist: 0,
    low_correction_draft_blocklist: 0,
    schema_invalid: 0,
    eligible: 0,
  };

  /** @type {object[]} */
  const eligible = [];
  const ids = Array.from(staged_map.keys()).sort();

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const row = staged_map.get(id);
    const inf = row.inference || {};
    const tier = inf.confidence_tier || 'low';
    const primary = inf.genre_profile && inf.genre_profile.primary_genre;

    if (tier === 'low') {
      exclusion_counts.low_tier_blocklist += 1;
    }
    if (exclude_ost.has(id)) {
      exclusion_counts.ost_draft_blocklist += 1;
    }
    if (exclude_low_draft.has(id)) {
      exclusion_counts.low_correction_draft_blocklist += 1;
    }
    if (tier !== 'high') {
      exclusion_counts.not_high_tier += 1;
      continue;
    }
    if (!primary || primary === GENRE_PRIMARY_UNKNOWN) {
      exclusion_counts.primary_unknown += 1;
      continue;
    }
    if (inf.human_locked === true) {
      exclusion_counts.human_locked += 1;
      continue;
    }
    const override_row = overrides_doc.overrides_by_track_id[id] || null;
    if (manual_override_blocks_g3_f_genre_adopt(override_row)) {
      exclusion_counts.manual_override_blocks_genre += 1;
      continue;
    }
    if (ai_review[id] && AI_REVIEW_EXCLUDE_STATUSES.has(ai_review[id])) {
      exclusion_counts.ai_review_any += 1;
      continue;
    }
    if (exclude_ost.has(id) || exclude_low_draft.has(id)) {
      continue;
    }

    const patch = inference_to_adopt_patch(inf, adopt_source);
    const validation = validate_adopt_patch(patch);
    if (!validation.ok) {
      exclusion_counts.schema_invalid += 1;
      continue;
    }

    exclusion_counts.eligible += 1;
    eligible.push({
      track_id: id,
      title: inf.title || null,
      wave_id: row.wave_id,
      wave_number: row.wave_number,
      batch_id: row.batch_id,
      staged_path: row.staged_path,
      confidence_tier: tier,
      inference_source: inf.source || null,
      inference: inf,
      adopted_classification: patch,
      schema_validation: validation,
    });
  }

  eligible.sort(function (a, b) {
    return a.track_id.localeCompare(b.track_id);
  });

  return {
    eligible: eligible,
    exclusion_counts: exclusion_counts,
    staged_map: staged_map,
  };
}

function adopted_track_ids_from_registry(registry_doc) {
  /** @type {Set<string>} */
  const out = new Set();
  const map = (registry_doc && registry_doc.adoptions_by_track_id) || {};
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i += 1) {
    const id = keys[i];
    const row = map[id];
    if (row && row.status === 'adopted') {
      out.add(id);
    }
  }
  return out;
}

/**
 * @param {object} opts
 * @param {boolean} [opts.skip_registry_adopted=true] 自 eligible 池排除 registry 已 adopted（預設 true）
 */
export function select_g3_f_adopt_batch(opts) {
  const options = opts || {};
  const batch_size = options.batch_size != null ? options.batch_size : 10;
  const batch_index = options.batch_index != null ? options.batch_index : 0;
  const skip_registry_adopted = options.skip_registry_adopted !== false;
  const computed = compute_g3_f_eligible_candidates(options);

  /** @type {object[]} */
  let pool = computed.eligible;
  let registry_already_adopted = 0;
  if (skip_registry_adopted) {
    const registry_doc =
      options.registry_doc ||
      load_g3_f_adopt_registry({ file_path: options.registry_file_path });
    const adopted = adopted_track_ids_from_registry(registry_doc);
    if (adopted.size > 0) {
      pool = computed.eligible.filter(function (t) {
        return !adopted.has(t.track_id);
      });
      registry_already_adopted = computed.eligible.length - pool.length;
    }
  }

  const start = batch_index * batch_size;
  const exclusion_counts = {
    ...computed.exclusion_counts,
    registry_already_adopted: registry_already_adopted,
    eligible_pending_adoption: pool.length,
  };

  return {
    ...computed,
    exclusion_counts: exclusion_counts,
    eligible_pending_adoption: pool.length,
    batch: pool.slice(start, start + batch_size),
    batch_index: batch_index,
    batch_size: batch_size,
    skip_registry_adopted: skip_registry_adopted,
  };
}

/**
 * Apply 前：現況仍須符合採用條件，且 staged 與 plan 快照一致
 * @param {object} candidate
 * @param {object} opts
 */
export function assert_track_eligible_for_adopt_plan(candidate, opts) {
  const options = opts || {};
  const plan_track = options.plan_track;
  const overrides_doc = options.overrides_doc || empty_overrides_doc();
  const ai_review = options.ai_review || {};
  const staged_map = options.staged_map || load_deduped_g3_f_staged_map();
  /** @type {string[]} */
  const errors = [];

  const id = candidate.track_id;
  const override_row =
    overrides_doc.overrides_by_track_id && overrides_doc.overrides_by_track_id[id];
  if (manual_override_blocks_g3_f_genre_adopt(override_row)) {
    errors.push('manual_override_blocks_genre');
  }
  if (ai_review[id] && AI_REVIEW_EXCLUDE_STATUSES.has(ai_review[id])) {
    errors.push('ai_review_blocked:' + ai_review[id]);
  }

  const staged = staged_map.get(id);
  if (!staged || !staged.inference) {
    errors.push('staged_missing');
  } else {
    const inf = staged.inference;
    if ((inf.confidence_tier || 'low') !== 'high') {
      errors.push('tier_not_high');
    }
    if (inf.human_locked === true) {
      errors.push('human_locked');
    }
    const patch = inference_to_adopt_patch(inf, G3_F_ADOPT_REGISTRY_SOURCE);
    if (
      JSON.stringify(patch) !== JSON.stringify(plan_track.adopted_classification) &&
      JSON.stringify(patch) !== JSON.stringify(candidate.adopted_classification)
    ) {
      errors.push('staged_classification_drift');
    }
    if (plan_track.idempotency_key) {
      const expected_key =
        candidate.wave_id + ':' + id + ':' + G3_F_ADOPT_REGISTRY_SOURCE;
      if (plan_track.idempotency_key !== expected_key) {
        errors.push('plan_idempotency_key_invalid');
      }
    }
  }

  return { ok: errors.length === 0, errors: errors };
}
