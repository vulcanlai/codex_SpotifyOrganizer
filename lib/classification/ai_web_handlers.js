/**
 * AI 候選審核 API（支援 v1 / v2 candidate_version）
 */
import fs from 'node:fs';
import {
  FILE_AI_SAMPLE,
  FILE_AI_CANDIDATES,
  FILE_AI_CANDIDATES_V2,
  FILE_AI_REVIEW_V2,
  FILE_AI_COMPARE_SUMMARY,
  FILE_CLASSIFICATION_INDEX,
  FILE_AI_REVIEW,
  AI_CANDIDATE_VERSION_V2,
} from './paths.js';
import {
  load_ai_review,
  load_ai_review_at,
  count_review_stats,
  REVIEW_ACCEPTED,
  REVIEW_REJECTED,
  REVIEW_PENDING,
  REVIEW_MODIFIED,
} from './ai_review_store.js';
import { ClassificationApiError } from './web_handlers.js';
import { genre_profile_from_ai_candidate } from './genre_profile.js';
import {
  parse_candidate_version,
  candidates_file_for_version,
  review_file_for_version,
} from './ai_version.js';
import { compare_one_candidate } from './ai_compare.js';
import { apply_ai_review_action } from './ai_review_apply.js';
import { execute_batch_review } from './ai_batch_review.js';
import { build_formal_classification_state } from './formal_state_build.js';
import {
  get_test_batch_config,
  normalize_test_batch_id,
  list_test_batches_status,
  TEST_BATCH_V2_30,
} from './ai_test_batches.js';
import { load_classification_settings } from './preview_settings.js';
import { build_phase_e_quality_report } from './ai_quality_report.js';

function read_json(path) {
  if (!fs.existsSync(path)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function read_tracks_index() {
  const doc = read_json(FILE_CLASSIFICATION_INDEX);
  return doc && doc.tracks_by_id ? doc.tracks_by_id : {};
}

function read_candidates_doc(version) {
  return read_json(candidates_file_for_version(version));
}

function load_review_for_version(version) {
  if (version === AI_CANDIDATE_VERSION_V2) {
    return load_ai_review_at(FILE_AI_REVIEW_V2);
  }
  return load_ai_review();
}

function find_candidate(doc, track_id) {
  const list = doc && doc.candidates ? doc.candidates : [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].spotify_id === track_id) {
      return list[i];
    }
  }
  return null;
}

function json_response(status, data) {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data),
  };
}

function v2_available() {
  return !!read_json(FILE_AI_CANDIDATES_V2);
}

function default_candidate_version() {
  return v2_available() ? AI_CANDIDATE_VERSION_V2 : 1;
}

/**
 * v1 候選／審核走 paths.js；v2 測試批次走 batch 設定檔
 * @param {object} cfg get_test_batch_config
 * @param {number} version
 */
function resolve_batch_candidate_and_review_paths(cfg, version) {
  if (version === AI_CANDIDATE_VERSION_V2) {
    return {
      candidates_path: cfg.candidates_imported_file,
      review_path: cfg.review_file,
    };
  }
  return {
    candidates_path: candidates_file_for_version(1),
    review_path: review_file_for_version(1),
  };
}

function resolve_test_batch(params, body) {
  const settings = load_classification_settings();
  const raw =
    (body && body.test_batch_id) ||
    (params && params.get('test_batch_id')) ||
    settings.active_test_batch ||
    TEST_BATCH_V2_30;
  return normalize_test_batch_id(raw);
}

/**
 * @param {string} method
 * @param {string} pathname
 * @param {string} body_text
 * @param {URLSearchParams} [search_params]
 */
export async function handle_ai_classification_api(
  method,
  pathname,
  body_text,
  search_params
) {
  const params = search_params || new URLSearchParams();

  if (pathname === '/api/ai/status' && method === 'GET') {
    const sample = read_json(FILE_AI_SAMPLE);
    const v1_candidates = read_json(FILE_AI_CANDIDATES);
    const v2_candidates = read_json(FILE_AI_CANDIDATES_V2);
    const v1_review = load_ai_review();
    const v2_review = load_ai_review_at(FILE_AI_REVIEW_V2);
    const v1_stats = count_review_stats(v1_review);
    const v2_stats = count_review_stats(v2_review);
    return json_response(200, {
      has_sample: !!sample,
      has_candidates: !!v1_candidates,
      has_candidates_v2: !!v2_candidates,
      sample_id: sample ? sample.sample_id : null,
      sample_size: sample ? sample.track_count : 0,
      imported_at: v1_candidates ? v1_candidates.imported_at : null,
      imported_at_v2: v2_candidates ? v2_candidates.imported_at : null,
      active_candidate_version: default_candidate_version(),
      review_stats: v1_stats,
      review_stats_v2: v2_stats,
      v1_human_confirmed: {
        accepted: v1_stats.accepted,
        rejected: v1_stats.rejected,
        modified: v1_stats.modified,
      },
      test_batches: list_test_batches_status(),
      active_test_batch: load_classification_settings().active_test_batch,
    });
  }

  if (pathname === '/api/ai/batches' && method === 'GET') {
    const batches = list_test_batches_status();
    const settings = load_classification_settings();
    return json_response(200, {
      batches,
      active_test_batch: settings.active_test_batch,
    });
  }

  if (pathname === '/api/ai/quality' && method === 'GET') {
    const batch = resolve_test_batch(params, null);
    const report = build_phase_e_quality_report({
      test_batch_id: batch,
      write: false,
    });
    return json_response(200, { test_batch_id: batch, report });
  }

  if (pathname === '/api/ai/compare' && method === 'GET') {
    const track_id = params.get('spotify_id') || params.get('track_id');
    const sample = read_json(FILE_AI_SAMPLE);
    const v1 = read_json(FILE_AI_CANDIDATES);
    const v2 = read_json(FILE_AI_CANDIDATES_V2);
    if (!sample || !v1 || !v2) {
      throw new ClassificationApiError('缺少 v1 或 v2 候選，無法比較', 404);
    }
    if (track_id) {
      const c1 = find_candidate(v1, track_id);
      const c2 = find_candidate(v2, track_id);
      const v1_rev = load_ai_review().reviews_by_track_id[track_id] || null;
      return json_response(200, {
        spotify_id: track_id,
        compare: compare_one_candidate(c1, c2),
        v1_candidate: c1,
        v2_candidate: c2,
        v1_review: v1_rev,
        v1_human_confirmed:
          v1_rev &&
          (v1_rev.status === REVIEW_ACCEPTED ||
            v1_rev.status === REVIEW_MODIFIED ||
            v1_rev.status === REVIEW_REJECTED),
      });
    }
    const summary = read_json(FILE_AI_COMPARE_SUMMARY);
    if (summary) {
      return json_response(200, summary);
    }
    return json_response(404, { error: '尚無 compare-summary' });
  }

  if (pathname === '/api/ai/tracks' && method === 'GET') {
    const version = parse_candidate_version(
      params.get('candidate_version') || default_candidate_version()
    );
    const test_batch = resolve_test_batch(params, null);
    const cfg = get_test_batch_config(test_batch);
    const paths = resolve_batch_candidate_and_review_paths(cfg, version);
    const sample = read_json(cfg.sample_file);
    const candidates = read_json(paths.candidates_path);
    if (!sample) {
      throw new ClassificationApiError('尚未建立測試樣本：' + test_batch, 404);
    }
    if (!candidates || !candidates.candidates) {
      throw new ClassificationApiError('尚未匯入 AI 候選：' + test_batch, 404);
    }
    const review = load_ai_review_at(paths.review_path);
    const v1_review =
      cfg.supports_v1_compare && version === AI_CANDIDATE_VERSION_V2
        ? load_ai_review()
        : null;
    const tracks_index = read_tracks_index();
    const index_doc = read_json(FILE_CLASSIFICATION_INDEX);
    const formal_doc =
      version === AI_CANDIDATE_VERSION_V2 && index_doc
        ? build_formal_classification_state(index_doc, { write: false })
        : null;
    const items = [];
    for (let i = 0; i < sample.track_ids.length; i += 1) {
      const id = sample.track_ids[i];
      const row = tracks_index[id] || null;
      const cand = find_candidate(candidates, id);
      const rev = review.reviews_by_track_id[id] || { status: REVIEW_PENDING };
      const v1_rev =
        v1_review && v1_review.reviews_by_track_id[id]
          ? v1_review.reviews_by_track_id[id]
          : null;
      const formal_row =
        formal_doc && formal_doc.states_by_track_id
          ? formal_doc.states_by_track_id[id]
          : null;
      items.push({
        spotify_id: id,
        test_batch_id: test_batch,
        candidate_version: version,
        display: row ? row.display : null,
        metadata_status: row ? row.metadata_status : 'metadata_missing',
        genre_profile: row ? row.genre_profile : null,
        candidate: cand,
        genre_profile_suggested: cand ? genre_profile_from_ai_candidate(cand) : null,
        review: rev,
        formal_state: formal_row ? formal_row.formal_state : null,
        confidence_tier: formal_row ? formal_row.confidence_tier : null,
        v1_review: v1_rev,
        v1_human_confirmed:
          v1_rev &&
          (v1_rev.status === REVIEW_ACCEPTED ||
            v1_rev.status === REVIEW_MODIFIED ||
            v1_rev.status === REVIEW_REJECTED),
      });
    }
    const batch_summary = list_test_batches_status().find(function (b) {
      return b.test_batch_id === test_batch;
    });
    return json_response(200, {
      test_batch_id: test_batch,
      batch_label: cfg.label_zh,
      candidate_version: version,
      items,
      review_stats: count_review_stats(review),
      batch_summary: batch_summary || null,
    });
  }

  if (pathname.indexOf('/api/ai/track/') === 0 && method === 'GET') {
    const track_id = decodeURIComponent(pathname.slice('/api/ai/track/'.length));
    const version = parse_candidate_version(
      params.get('candidate_version') || default_candidate_version()
    );
    const test_batch = resolve_test_batch(params, null);
    const cfg = get_test_batch_config(test_batch);
    const paths = resolve_batch_candidate_and_review_paths(cfg, version);
    const candidates = read_json(paths.candidates_path);
    if (!candidates) {
      throw new ClassificationApiError('尚未匯入 AI 候選', 404);
    }
    const tracks_index = read_tracks_index();
    const review = load_ai_review_at(paths.review_path);
    const cand = find_candidate(candidates, track_id);
    const track_row = tracks_index[track_id] || null;
    const v1 = read_json(FILE_AI_CANDIDATES);
    const v2 = read_json(FILE_AI_CANDIDATES_V2);
    const c1 = v1 ? find_candidate(v1, track_id) : null;
    const c2 = v2 ? find_candidate(v2, track_id) : null;
    const v1_rev = load_ai_review().reviews_by_track_id[track_id] || null;
    return json_response(200, {
      test_batch_id: test_batch,
      candidate_version: version,
      track: track_row,
      candidate: cand,
      genre_profile_suggested: cand ? genre_profile_from_ai_candidate(cand) : null,
      review: review.reviews_by_track_id[track_id] || { status: REVIEW_PENDING },
      compare: cfg.supports_v1_compare ? compare_one_candidate(c1, c2) : null,
      v1_candidate: c1,
      v2_candidate: c2,
      v1_review: v1_rev,
      v1_human_confirmed:
        v1_rev &&
        (v1_rev.status === REVIEW_ACCEPTED ||
          v1_rev.status === REVIEW_MODIFIED ||
          v1_rev.status === REVIEW_REJECTED),
    });
  }

  if (pathname === '/api/ai/review' && method === 'POST') {
    const body = parse_json_body(body_text);
    const track_id = body.spotify_id;
    const action = body.action;
    const version = parse_candidate_version(
      body.candidate_version || default_candidate_version()
    );
    const test_batch = resolve_test_batch(params, body);
    const cfg = get_test_batch_config(test_batch);
    const paths = resolve_batch_candidate_and_review_paths(cfg, version);
    if (!track_id || !action) {
      return json_response(400, { error: '缺少 spotify_id 或 action' });
    }
    const sample = read_json(cfg.sample_file);
    const candidates = read_json(paths.candidates_path);
    if (!sample || !candidates) {
      throw new ClassificationApiError('尚未匯入 AI 候選', 404);
    }
    if (sample.track_ids.indexOf(track_id) < 0) {
      return json_response(400, { error: '不在目前測試批次樣本中' });
    }
    const candidate = find_candidate(candidates, track_id);
    if (!candidate) {
      return json_response(400, { error: '找不到候選' });
    }

    const review = load_ai_review_at(paths.review_path);
    const review_path = paths.review_path;
    const applied = apply_ai_review_action({
      track_id,
      action,
      version,
      candidate,
      review_doc: review,
      review_path,
      body,
      source: 'classify:ui',
    });
    if (!applied.ok) {
      return json_response(applied.http_status || 400, {
        error: applied.error,
        code: applied.code,
      });
    }
    if (version === AI_CANDIDATE_VERSION_V2) {
      const idx_doc = applied.built
        ? applied.built.index_doc
        : read_json(FILE_CLASSIFICATION_INDEX);
      if (idx_doc) {
        build_formal_classification_state(idx_doc, { write: true });
      }
    }
    const payload = {
      ok: true,
      test_batch_id: test_batch,
      candidate_version: version,
      review: applied.review,
    };
    if (applied.built) {
      payload.track = applied.built.index_doc.tracks_by_id[track_id];
      payload.summary = applied.built.summary_doc;
    }
    return json_response(200, payload);
  }

  if (pathname === '/api/ai/batch-review' && method === 'POST') {
    const body = parse_json_body(body_text);
    const version = parse_candidate_version(
      body.candidate_version || AI_CANDIDATE_VERSION_V2
    );
    if (version !== AI_CANDIDATE_VERSION_V2) {
      return json_response(400, { error: '批次審核僅支援 v2' });
    }
    const track_ids = body.spotify_ids || body.track_ids || [];
    const dry_run = body.confirm !== true;
    const test_batch = resolve_test_batch(params, body);
    const exec_result = execute_batch_review({
      candidate_version: version,
      test_batch_id: test_batch,
      action: body.action,
      track_ids,
      client_operation_id: body.client_operation_id || null,
      dry_run,
      source: 'classify:ui-batch',
    });
    if (!exec_result.ok) {
      return json_response(400, { error: exec_result.errors.join('；') });
    }
    return json_response(200, exec_result);
  }

  return null;
}

function parse_json_body(text) {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
