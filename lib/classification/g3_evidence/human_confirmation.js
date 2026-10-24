/**
 * 人工確認來源彙整（不得僅讀 manual-overrides.json）
 */
import {
  FILE_AI_REVIEW_V2,
  FILE_AI_REVIEW_V1,
} from '../paths.js';
import {
  FILE_PHASE_E_REVIEW,
} from '../ai_test_batches.js';
import {
  REVIEW_ACCEPTED,
  REVIEW_MODIFIED,
  REVIEW_REJECTED,
} from '../ai_review_store.js';
import fs from 'node:fs';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * @param {string} track_id
 * @param {object} ctx
 */
export function resolve_human_confirmation(track_id, ctx) {
  const index_row = ctx.index_row || null;
  const override_row =
    ctx.override_row ||
    (ctx.overrides_doc && ctx.overrides_doc.overrides_by_track_id
      ? ctx.overrides_doc.overrides_by_track_id[track_id]
      : null);

  /** @type {string[]} */
  const sources = [];
  let locked = false;
  let review_status = null;
  let review_batch = null;

  if (override_row) {
    locked = true;
    sources.push('manual-overrides.json');
  }

  const v2 = ctx.v2_review || read_review_track(read_json(FILE_AI_REVIEW_V2), track_id);
  const phase = ctx.phase_review || read_review_track(read_json(FILE_PHASE_E_REVIEW), track_id);
  const review = v2 || phase;
  if (review) {
    review_status = review.status;
    review_batch = v2 ? 'v2-30' : 'phase-e-100';
    if (review_status === REVIEW_ACCEPTED || review_status === REVIEW_MODIFIED) {
      locked = true;
      sources.push('ai-review:' + review_batch + ':' + review_status);
    }
    if (review_status === REVIEW_REJECTED) {
      sources.push('ai-review:' + review_batch + ':rejected');
    }
  }

  if (index_row) {
    const tags = index_row.tags || [];
    for (let i = 0; i < tags.length; i += 1) {
      if (tags[i].is_manual_override) {
        locked = true;
        if (sources.indexOf('classification-index:manual_tag') < 0) {
          sources.push('classification-index:manual_tag');
        }
      }
    }
    const gp = index_row.genre_profile;
    if (gp && gp.source === 'manual-overrides.json') {
      locked = true;
      if (sources.indexOf('classification-index:genre_profile') < 0) {
        sources.push('classification-index:genre_profile');
      }
    }
  }

  return {
    locked: locked,
    sources: sources,
    review_status: review_status,
    review_batch: review_batch,
    override_row: override_row,
    genre_profile: index_row && index_row.genre_profile ? index_row.genre_profile : null,
    manual_tags: index_row
      ? (index_row.tags || []).filter(function (t) {
          return t.is_manual_override;
        })
      : [],
  };
}

function read_review_track(doc, track_id) {
  if (!doc || !doc.tracks) {
    return null;
  }
  return doc.tracks[track_id] || null;
}

/**
 * @param {object} bundle from load_g3_source_bundle extended with index row
 */
export function count_human_confirmation_stats(index_doc, bundle) {
  const tracks = index_doc.tracks_by_id || {};
  const ids = Object.keys(tracks);
  let locked = 0;
  let review_accepted = 0;
  let review_rejected = 0;
  let override_file = 0;

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const h = resolve_human_confirmation(id, {
      index_row: tracks[id],
      overrides_doc: bundle.manual_overrides,
      v2_review: bundle.ai_review_by_id[id] ? bundle.ai_review_by_id[id].review : null,
      phase_review: null,
    });
    if (h.override_row) {
      override_file += 1;
    }
    if (h.review_status === REVIEW_ACCEPTED || h.review_status === REVIEW_MODIFIED) {
      review_accepted += 1;
    }
    if (h.review_status === REVIEW_REJECTED) {
      review_rejected += 1;
    }
    if (h.locked) {
      locked += 1;
    }
  }
  return {
    human_locked_tracks: locked,
    manual_overrides_file_rows: override_file,
    ai_review_accepted_or_modified: review_accepted,
    ai_review_rejected: review_rejected,
  };
}
