/**
 * 分類 Web UI API（僅本機）
 */
import fs from 'node:fs';
import {
  FILE_CLASSIFICATION_INDEX,
  FILE_CLASSIFICATION_SUMMARY,
} from './paths.js';
import { build_classification_index } from './build_index.js';
import {
  load_manual_overrides,
  save_manual_overrides,
  upsert_track_override,
} from './overrides_store.js';
import {
  search_classification_tracks,
  get_classification_track,
} from './search.js';
import { handle_ai_classification_api } from './ai_web_handlers.js';
import { handle_quality_audit_api } from './quality_audit_web_handlers.js';
import { handle_external_verify_api } from './external_verify_handlers.js';
import { taxonomy_export_for_ui } from './genre_taxonomy.js';
import { normalize_genre_profile, validate_genre_profile } from './genre_profile.js';
import {
  load_classification_settings,
  save_classification_settings,
  PREVIEW_MODE_VALUES,
} from './preview_settings.js';
import {
  compute_smart_playlist_preview,
  compare_preview_modes,
} from './smart_playlist_preview.js';
import { build_formal_classification_state } from './formal_state_build.js';
import { run_g3_c1_build } from './g3_c/run_g3_c1_build.js';
import { load_unified_classification_view } from './g3_c/build_unified_view.js';
import { compute_g3_unified_playlist_preview } from './g3_c/g3_smart_playlist_preview.js';
import {
  build_mvp_playlist_catalog,
  preview_mvp_playlist_tracks,
} from './mvp_smart_playlists.js';
import { run_mvp_spotify_sync_dry_run } from './mvp_playlist_sync.js';
import {
  FILE_G3_C1_UNIFIED_SUMMARY,
  FILE_G3_C1_FIELD_TASKS,
} from './g3_c/paths_c1.js';
import { load_latest_plan } from '../managed_playlists/stores.js';
import { apply_managed_playlist_plan } from '../managed_playlists/apply_local.js';
import { MANAGED_PLAYLIST_APPLY_TOKEN } from '../managed_playlists/constants.js';

export class ClassificationApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ClassificationApiError';
    this.status = status || 400;
  }
}

function read_index_doc() {
  if (!fs.existsSync(FILE_CLASSIFICATION_INDEX)) {
    throw new ClassificationApiError(
      '尚未建立 classification-index.json，請先執行 npm run classify:build。',
      404
    );
  }
  try {
    return JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8'));
  } catch (err) {
    throw new ClassificationApiError(
      `無法讀取 classification-index：${err && err.message ? err.message : err}`,
      500
    );
  }
}

function read_summary_doc() {
  if (!fs.existsSync(FILE_CLASSIFICATION_SUMMARY)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_SUMMARY, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} method
 * @param {string} pathname
 * @param {string} body_text
 * @param {URLSearchParams} [search_params]
 */
export async function handle_classification_api(
  method,
  pathname,
  body_text,
  search_params
) {
  if (pathname === '/api/status' && method === 'GET') {
    const summary = read_summary_doc();
    if (!summary) {
      return json_response(404, {
        error: '缺少 classification-summary.json',
      });
    }
    return json_response(200, { summary });
  }

  if (pathname === '/api/tracks' && method === 'GET') {
    const index_doc = read_index_doc();
    const params = search_params || new URLSearchParams();
    const result = search_classification_tracks(index_doc, {
      q: params.get('q') || '',
      decade: params.get('decade') || '',
      language: params.get('language') || '',
      genre: params.get('genre') || '',
      primary_genre: params.get('primary_genre') || '',
      subgenre: params.get('subgenre') || '',
      context: params.get('context') || '',
      locate_track_id: params.get('locate_track_id') || '',
      locate_page: params.get('locate_page') === '1',
      limit: parse_int(params.get('limit'), 50),
      offset: parse_int(params.get('offset'), 0),
    });
    return json_response(200, result);
  }

  if (pathname.indexOf('/api/track/') === 0 && method === 'GET') {
    const track_id = decodeURIComponent(pathname.slice('/api/track/'.length));
    const index_doc = read_index_doc();
    const row = get_classification_track(index_doc, track_id);
    if (!row) {
      return json_response(404, { error: '找不到曲目' });
    }
    return json_response(200, { track: row });
  }

  if (pathname === '/api/overrides' && method === 'POST') {
    const body = parse_json_body(body_text);
    if (!body.spotify_id) {
      return json_response(400, { error: '缺少 spotify_id' });
    }
    const doc = load_manual_overrides();
    if (body.genre_profile) {
      const gp_errors = validate_genre_profile(body.genre_profile);
      if (gp_errors.length) {
        return json_response(400, { error: gp_errors.join('；') });
      }
      body.genre_profile = normalize_genre_profile(body.genre_profile);
    }
    upsert_track_override(doc, body.spotify_id, {
      source: body.source || 'classify:ui',
      language: body.language,
      genres: body.genres,
      contexts: body.contexts,
      special_types: body.special_types,
      genre_profile: body.genre_profile,
      remove_genres: body.remove_genres,
      remove_contexts: body.remove_contexts,
      remove_special_types: body.remove_special_types,
      exclude_dimensions: body.exclude_dimensions,
      clear: body.clear === true,
    });
    save_manual_overrides(doc);
    const built = build_classification_index();
    return json_response(200, {
      ok: true,
      summary: built.summary_doc,
      track: built.index_doc.tracks_by_id[body.spotify_id],
    });
  }

  if (pathname === '/api/taxonomy/genres' && method === 'GET') {
    return json_response(200, taxonomy_export_for_ui());
  }

  if (pathname === '/api/rebuild' && method === 'POST') {
    const built = build_classification_index();
    build_formal_classification_state(built.index_doc, { write: true });
    return json_response(200, {
      ok: true,
      summary: built.summary_doc,
    });
  }

  if (pathname === '/api/preview/settings' && method === 'GET') {
    return json_response(200, {
      settings: load_classification_settings(),
      preview_mode_options: PREVIEW_MODE_VALUES,
    });
  }

  if (pathname === '/api/preview/settings' && method === 'POST') {
    const body = parse_json_body(body_text);
    const saved = save_classification_settings({
      preview_mode: body.preview_mode,
      batch_review_max: body.batch_review_max,
      active_test_batch: body.active_test_batch,
    });
    return json_response(200, { ok: true, settings: saved });
  }

  if (pathname === '/api/preview/playlist' && method === 'GET') {
    const index_doc = read_index_doc();
    const params = search_params || new URLSearchParams();
    const filters = {
      decade: params.get('decade') || '',
      language: params.get('language') || '',
      primary_genre: params.get('primary_genre') || '',
      subgenre: params.get('subgenre') || '',
      context: params.get('context') || '',
    };
    const mode = params.get('preview_mode') || '';
    const preview = compute_smart_playlist_preview(
      index_doc,
      filters,
      mode || undefined
    );
    let g3_preview = null;
    if (fs.existsSync(FILE_G3_C1_UNIFIED_SUMMARY)) {
      g3_preview = compute_g3_unified_playlist_preview(
        Object.assign({}, filters, {
          special_type: params.get('special_type') || '',
        }),
        mode || undefined
      );
    }
    return json_response(200, { preview: preview, g3_unified_preview: g3_preview });
  }

  if (pathname === '/api/mvp/playlists' && method === 'GET') {
    const index_doc = read_index_doc();
    const catalog = build_mvp_playlist_catalog(index_doc);
    return json_response(200, {
      local_only: true,
      not_synced_spotify: true,
      library_track_count: catalog.library_track_count,
      policies: catalog.policies,
      language_genre_playlists: (catalog.language_genre_playlists || []).map(function (p) {
        return {
          playlist_id: p.playlist_id,
          label_zh: p.label_zh,
          language_bucket: p.language_bucket,
          primary_genre: p.primary_genre,
          track_count: p.track_count,
          playable_count: p.playable_count,
          by_genre_confidence: p.by_genre_confidence,
        };
      }),
      language_stats: catalog.language_stats || null,
      emotion_playlists_tentative: catalog.emotion_playlists_tentative.map(function (p) {
        return {
          playlist_id: p.playlist_id,
          label_zh: p.label_zh,
          track_count: p.track_count,
          playable_count: p.playable_count,
          source: p.source,
        };
      }),
    });
  }

  if (pathname === '/api/mvp/sync/dry-run' && method === 'GET') {
    const plan = run_mvp_spotify_sync_dry_run();
    return json_response(200, {
      dry_run: true,
      not_synced_spotify: true,
      playlist_count: plan.playlist_count,
      total_valid_uris: plan.total_valid_uris,
      total_invalid_or_excluded: plan.total_invalid_or_excluded,
      estimated_api_requests: plan.estimated_api_requests,
      scopes_ok: plan.scopes_ok,
      missing_scopes: plan.missing_scopes,
      reauth_hint_zh: plan.reauth_hint_zh,
      playlists: plan.playlists.map(function (pl) {
        return {
          mvp_playlist_id: pl.mvp_playlist_id,
          spotify_name: pl.spotify_name,
          valid_uri_count: pl.valid_uri_count,
          estimated_api_requests: pl.estimated_api_requests,
        };
      }),
    });
  }

  if (pathname === '/api/mvp/playlist' && method === 'GET') {
    const index_doc = read_index_doc();
    const params = search_params || new URLSearchParams();
    const playlist_id = params.get('playlist_id') || '';
    const catalog = build_mvp_playlist_catalog(index_doc);
    const preview = preview_mvp_playlist_tracks(catalog, playlist_id, index_doc);
    if (!preview.ok) {
      return json_response(404, preview);
    }
    const limit = parseInt(params.get('limit') || '50', 10);
    const offset = parseInt(params.get('offset') || '0', 10);
    preview.tracks = preview.tracks.slice(offset, offset + Math.min(limit, 200));
    return json_response(200, preview);
  }

  if (pathname === '/api/g3/c1/summary' && method === 'GET') {
    if (!fs.existsSync(FILE_G3_C1_UNIFIED_SUMMARY)) {
      const built = run_g3_c1_build({ write: true });
      return json_response(200, {
        summary: built.summary,
        tasks: { task_count: built.task_count },
        rebuilt: true,
      });
    }
    const summary = JSON.parse(fs.readFileSync(FILE_G3_C1_UNIFIED_SUMMARY, 'utf8'));
    let tasks_meta = { task_count: 0 };
    if (fs.existsSync(FILE_G3_C1_FIELD_TASKS)) {
      const td = JSON.parse(fs.readFileSync(FILE_G3_C1_FIELD_TASKS, 'utf8'));
      tasks_meta = {
        task_count: td.task_count,
        needs_evidence_track_count: td.needs_evidence_track_count,
        human_required_task_count: td.human_required_task_count,
      };
    }
    const unified = load_unified_classification_view();
    let ai_coverage_100 = 0;
    if (unified && unified.tracks) {
      const ids = Object.keys(unified.tracks);
      for (let i = 0; i < ids.length; i += 1) {
        if (unified.tracks[ids[i]].in_g3_sample_100) {
          ai_coverage_100 += 1;
        }
      }
    }
    return json_response(200, {
      summary: summary,
      tasks: tasks_meta,
      g3_sample_100_in_view: ai_coverage_100,
    });
  }

  if (pathname === '/api/g3/c1/preview/playlist' && method === 'GET') {
    const params = search_params || new URLSearchParams();
    const filters = {
      decade: params.get('decade') || '',
      language: params.get('language') || '',
      primary_genre: params.get('primary_genre') || '',
      subgenre: params.get('subgenre') || '',
      context: params.get('context') || '',
      special_type: params.get('special_type') || '',
    };
    const mode = params.get('preview_mode') || '';
    if (!load_unified_classification_view()) {
      run_g3_c1_build({ write: true });
    }
    const g3_preview = compute_g3_unified_playlist_preview(
      filters,
      mode || undefined
    );
    return json_response(200, { preview: g3_preview, local_only: true });
  }

  if (pathname === '/api/preview/playlist/compare-modes' && method === 'GET') {
    const index_doc = read_index_doc();
    const params = search_params || new URLSearchParams();
    const filters = {
      decade: params.get('decade') || '',
      language: params.get('language') || '',
      primary_genre: params.get('primary_genre') || '',
      subgenre: params.get('subgenre') || '',
      context: params.get('context') || '',
    };
    const compared = compare_preview_modes(index_doc, filters);
    return json_response(200, { compared, local_only: true });
  }

  if (pathname === '/api/classification/formal-state' && method === 'GET') {
    const index_doc = read_index_doc();
    const doc = build_formal_classification_state(index_doc, { write: false });
    return json_response(200, {
      formal_state: doc,
      sample_tier_counts: doc.sample_tier_counts,
      formal_state_counts: doc.formal_state_counts,
    });
  }

  if (pathname.indexOf('/api/ai/') === 0) {
    const ai_result = await handle_ai_classification_api(
      method,
      pathname,
      body_text,
      search_params
    );
    if (ai_result) {
      return ai_result;
    }
  }

  if (pathname.indexOf('/api/quality-audit/') === 0) {
    const qa_result = await handle_quality_audit_api(
      method,
      pathname,
      body_text,
      search_params
    );
    if (qa_result) {
      return qa_result;
    }
  }

  if (pathname === '/api/managed-playlists/plan' && method === 'GET') {
    const plan = load_latest_plan();
    if (!plan) {
      return json_response(200, {
        ok: true,
        has_plan: false,
        note_zh: '尚無讀回預覽。請先執行 npm run playlists:preview（唯讀，不保存）。',
      });
    }
    return json_response(200, {
      ok: true,
      has_plan: true,
      applied: plan.applied === true,
      plan_hash: plan.plan_hash,
      account_id: plan.account_id,
      created_at: plan.created_at,
      summary: plan.summary,
      conflict_count: (plan.conflicts || []).length,
      note_zh: plan.applied
        ? '此 plan 已保存。'
        : '此為唯讀預覽；UI 確認仍須同一確認旗標，不能略過 CLI 安全檢查。',
    });
  }

  if (pathname === '/api/managed-playlists/apply' && method === 'POST') {
    const body = parse_json_body(body_text);
    if (body.confirm !== MANAGED_PLAYLIST_APPLY_TOKEN) {
      return json_response(400, { ok: false, error: '缺少或錯誤的確認旗標' });
    }
    const result = apply_managed_playlist_plan({
      plan_hash: body.plan_hash,
      confirm: body.confirm,
    });
    return json_response(result.ok ? 200 : 400, result);
  }

  if (pathname.indexOf('/api/external-verify/') === 0) {
    const ev = handle_external_verify_api(method, pathname);
    if (ev) {
      return json_response(ev.status, ev.body);
    }
  }

  return null;
}

function parse_int(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
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

function json_response(status, data) {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data),
  };
}
