/**
 * 單曲 AI 審核套用（v1 / v2）
 */
import { build_classification_index } from './build_index.js';
import {
  load_manual_overrides,
  save_manual_overrides,
  upsert_track_override,
} from './overrides_store.js';
import {
  save_ai_review_at,
  REVIEW_ACCEPTED,
  REVIEW_REJECTED,
  REVIEW_PENDING,
  REVIEW_MODIFIED,
} from './ai_review_store.js';
import {
  normalize_genre_profile,
  validate_genre_profile,
} from './genre_profile.js';
import { candidate_to_override_patch } from './ai_review_store.js';
import { AI_CANDIDATE_VERSION_V2 } from './paths.js';

/**
 * @returns {{ ok: boolean, http_status?: number, error?: string, code?: string, review?: object, built?: object }}
 */
export function apply_ai_review_action(params) {
  const track_id = params.track_id;
  const action = params.action;
  const version = params.version;
  const candidate = params.candidate;
  const review_doc = params.review_doc;
  const body = params.body || {};
  const now = params.now || new Date().toISOString();

  const overrides = params.overrides || load_manual_overrides();
  const existing = overrides.overrides_by_track_id[track_id];

  if (
    existing &&
    existing.source &&
    existing.source.indexOf('ai_review') < 0 &&
    (action === REVIEW_ACCEPTED ||
      action === 'accept' ||
      action === REVIEW_MODIFIED ||
      action === 'accept_modified')
  ) {
    return {
      ok: false,
      http_status: 409,
      error: '此曲已有非 AI 人工覆寫，AI 候選僅供參考，無法覆蓋。',
      code: 'manual_override_conflict',
    };
  }

  if (action === 'reject' || action === REVIEW_REJECTED) {
    review_doc.reviews_by_track_id[track_id] = {
      status: REVIEW_REJECTED,
      updated_at: now,
      source: params.source || 'classify:ui',
      candidate_version: version,
    };
    if (params.persist !== false) {
      save_ai_review_at(params.review_path, review_doc);
    }
    return {
      ok: true,
      review: review_doc.reviews_by_track_id[track_id],
      skipped_override: true,
    };
  }

  if (action === 'pending' || action === REVIEW_PENDING) {
    review_doc.reviews_by_track_id[track_id] = {
      status: REVIEW_PENDING,
      updated_at: now,
      source: params.source || 'classify:ui',
      candidate_version: version,
      label: version === AI_CANDIDATE_VERSION_V2 ? 'v2_pending' : null,
    };
    if (params.persist !== false) {
      save_ai_review_at(params.review_path, review_doc);
    }
    let built = null;
    if (version === 1 && params.persist !== false) {
      upsert_track_override(overrides, track_id, null);
      save_manual_overrides(overrides);
      built = build_classification_index();
    }
    return {
      ok: true,
      review: review_doc.reviews_by_track_id[track_id],
      built,
    };
  }

  if (
    action === 'accept' ||
    action === REVIEW_ACCEPTED ||
    action === 'accept_modified' ||
    action === REVIEW_MODIFIED
  ) {
    let patch = candidate_to_override_patch(candidate);
    if (action === 'accept_modified' || action === REVIEW_MODIFIED) {
      patch = {
        source: 'ai_review:modified',
        language: body.language || patch.language,
        genres: body.genres || patch.genres,
        contexts: body.contexts || patch.contexts,
        special_types: body.special_types || patch.special_types,
        genre_profile: patch.genre_profile,
      };
      if (body.genre_profile) {
        const gp_errors = validate_genre_profile(body.genre_profile);
        if (gp_errors.length) {
          return {
            ok: false,
            http_status: 400,
            error: gp_errors.join('；'),
            code: 'invalid_genre_profile',
          };
        }
        patch.genre_profile = normalize_genre_profile(body.genre_profile);
      }
    } else {
      patch.source = 'ai_review:accepted';
    }
    if (params.persist !== false) {
      upsert_track_override(overrides, track_id, patch);
      save_manual_overrides(overrides);
    }
    review_doc.reviews_by_track_id[track_id] = {
      status:
        action === 'accept_modified' || action === REVIEW_MODIFIED
          ? REVIEW_MODIFIED
          : REVIEW_ACCEPTED,
      updated_at: now,
      source: params.source || 'classify:ui',
      candidate_version: version,
    };
    if (params.persist !== false) {
      save_ai_review_at(params.review_path, review_doc);
    }
    let built = null;
    if (params.persist !== false) {
      built = build_classification_index();
    }
    return {
      ok: true,
      review: review_doc.reviews_by_track_id[track_id],
      built,
    };
  }

  return {
    ok: false,
    http_status: 400,
    error: '未知 action',
    code: 'unknown_action',
  };
}

export function normalize_review_action(action) {
  if (action === 'accept') {
    return REVIEW_ACCEPTED;
  }
  if (action === 'reject') {
    return REVIEW_REJECTED;
  }
  if (action === 'pending') {
    return REVIEW_PENDING;
  }
  return action;
}

export function target_status_for_action(action) {
  const a = normalize_review_action(action);
  if (a === REVIEW_ACCEPTED) {
    return REVIEW_ACCEPTED;
  }
  if (a === REVIEW_REJECTED) {
    return REVIEW_REJECTED;
  }
  if (a === REVIEW_PENDING) {
    return REVIEW_PENDING;
  }
  return null;
}
