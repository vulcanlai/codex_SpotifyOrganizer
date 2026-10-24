/**
 * 收藏專輯與曲目唯讀備份（支援中斷續傳）
 */
import {
  fetch_current_user,
  fetch_all_saved_albums,
  fetch_all_album_tracks,
  SpotifyRequestError,
} from '../spotify_api.js';
import {
  normalize_saved_album_row,
  normalize_album_track,
} from './normalize.js';
import {
  load_existing_library_backup,
  is_album_tracks_complete,
  index_track_sections,
  index_saved_albums,
  persist_library_backup,
} from './storage.js';
import { SCHEMA_VERSION } from './paths.js';

/**
 * @param {unknown} err
 */
function error_record(err) {
  if (err instanceof SpotifyRequestError) {
    return {
      status: err.status,
      message: err.message,
      spotify_error: err.body || null,
    };
  }
  return {
    status: null,
    message: err && err.message ? err.message : String(err),
    spotify_error: null,
  };
}

/**
 * 統計不重複 track id（保留各專輯內重複列）
 * @param {object[]} track_sections
 */
export function count_track_stats(track_sections) {
  let total_entries = 0;
  const unique = new Set();
  for (let i = 0; i < track_sections.length; i += 1) {
    const sec = track_sections[i];
    if (!sec || !Array.isArray(sec.tracks)) {
      continue;
    }
    for (let t = 0; t < sec.tracks.length; t += 1) {
      total_entries += 1;
      const id = sec.tracks[t].spotify_id;
      if (id) {
        unique.add(id);
      }
    }
  }
  return {
    total_track_entries: total_entries,
    unique_track_ids: unique.size,
  };
}

/**
 * 主備份流程
 */
export async function run_saved_albums_backup() {
  const started_at = new Date().toISOString();
  const errors = [];

  let user_id = null;
  try {
    const user = await fetch_current_user();
    user_id = user && user.id ? user.id : null;
  } catch (err) {
    errors.push({ phase: 'user_profile', ...error_record(err) });
  }

  const existing = load_existing_library_backup();
  const prev_saved_by_id = index_saved_albums(existing.saved);
  const prev_tracks_by_id = index_track_sections(existing.tracks);

  let albums_list_ok = false;
  let albums_total_from_api = null;
  /** @type {object[]} */
  let album_metas = [];

  try {
    const page = await fetch_all_saved_albums();
    albums_list_ok = true;
    albums_total_from_api = page.total_from_api;
    for (let i = 0; i < page.items.length; i += 1) {
      const meta = normalize_saved_album_row(page.items[i], i);
      if (!meta.album_id) {
        errors.push({
          phase: 'saved_albums_list',
          position: i,
          ...error_record(new Error('收藏列缺少 album.id')),
        });
        album_metas.push(meta);
        continue;
      }

      const prev = prev_saved_by_id[meta.album_id];
      const prev_sec = prev_tracks_by_id[meta.album_id];
      if (prev && prev_sec && is_album_tracks_complete(prev, prev_sec)) {
        album_metas.push({
          ...meta,
          tracks_read_status: prev.tracks_read_status,
          tracks_read_error: prev.tracks_read_error,
          tracks_fetched_count: prev.tracks_fetched_count,
          tracks_api_total: prev.tracks_api_total,
        });
      } else if (prev && prev.tracks_read_status === 'failed') {
        album_metas.push({
          ...meta,
          tracks_read_status: 'pending',
          tracks_read_error: null,
          tracks_fetched_count: 0,
          tracks_api_total: null,
        });
      } else {
        album_metas.push(meta);
      }
    }

    if (
      typeof albums_total_from_api === 'number' &&
      album_metas.length !== albums_total_from_api
    ) {
      errors.push({
        phase: 'saved_albums_list',
        message: `合併後專輯數 ${album_metas.length} 與 API total ${albums_total_from_api} 不一致`,
      });
    }
  } catch (err) {
    errors.push({ phase: 'saved_albums_list', ...error_record(err) });
  }

  /** @type {object[]} */
  const track_sections = [];
  let albums_tracks_ok = 0;
  let albums_tracks_failed = 0;
  let albums_tracks_pending = 0;
  let albums_skipped_resume = 0;

  if (albums_list_ok) {
    for (let a = 0; a < album_metas.length; a += 1) {
      const meta = album_metas[a];
      let section = prev_tracks_by_id[meta.album_id] || {
        album_id: meta.album_id,
        album_name: meta.name,
        read_status: 'pending',
        error: null,
        tracks: [],
      };

      if (is_album_tracks_complete(meta, section)) {
        track_sections.push(section);
        albums_tracks_ok += 1;
        albums_skipped_resume += 1;
        continue;
      }

      if (!meta.album_id) {
        section = {
          album_id: null,
          album_name: meta.name,
          read_status: 'failed',
          error: meta.tracks_read_error,
          tracks: [],
        };
        meta.tracks_read_status = 'failed';
        track_sections.push(section);
        albums_tracks_failed += 1;
        continue;
      }

      try {
        const tracks_page = await fetch_all_album_tracks(meta.album_id);
        const api_total = tracks_page.total_from_api;
        const tracks = [];
        for (let t = 0; t < tracks_page.items.length; t += 1) {
          tracks.push(
            normalize_album_track(tracks_page.items[t], {
              album_id: meta.album_id,
              position: t,
            })
          );
        }

        const expected =
          typeof meta.total_tracks === 'number'
            ? meta.total_tracks
            : api_total;

        let count_mismatch = false;
        if (typeof api_total === 'number' && tracks.length !== api_total) {
          count_mismatch = true;
          errors.push({
            phase: 'album_tracks',
            album_id: meta.album_id,
            message: `曲目分頁筆數 ${tracks.length} 與 API total ${api_total} 不一致`,
          });
        }
        if (
          typeof expected === 'number' &&
          typeof api_total === 'number' &&
          expected !== api_total
        ) {
          errors.push({
            phase: 'album_tracks',
            album_id: meta.album_id,
            message: `專輯 metadata total_tracks ${expected} 與曲目 API total ${api_total} 不一致（已記錄，不視為空專輯）`,
          });
        }

        if (count_mismatch) {
          meta.tracks_read_status = 'failed';
          meta.tracks_read_error = {
            message: '曲目分頁未完成或 total 不符',
          };
          meta.tracks_fetched_count = tracks.length;
          meta.tracks_api_total = api_total;
          section = {
            album_id: meta.album_id,
            album_name: meta.name,
            read_status: 'failed',
            error: meta.tracks_read_error,
            tracks: [],
          };
          albums_tracks_failed += 1;
        } else {
          meta.tracks_read_status = 'ok';
          meta.tracks_read_error = null;
          meta.tracks_fetched_count = tracks.length;
          meta.tracks_api_total = api_total;
          section = {
            album_id: meta.album_id,
            album_name: meta.name,
            read_status: 'ok',
            error: null,
            tracks,
          };
          albums_tracks_ok += 1;
        }
      } catch (err) {
        const rec = error_record(err);
        meta.tracks_read_status = 'failed';
        meta.tracks_read_error = rec;
        meta.tracks_fetched_count = 0;
        meta.tracks_api_total = null;
        section = {
          album_id: meta.album_id,
          album_name: meta.name,
          read_status: 'failed',
          error: rec,
          tracks: [],
        };
        albums_tracks_failed += 1;
        errors.push({
          phase: 'album_tracks',
          album_id: meta.album_id,
          album_name: meta.name,
          ...rec,
        });
      }

      track_sections.push(section);

      const checkpoint_doc = build_checkpoint(
        albums_total_from_api,
        album_metas,
        track_sections
      );
      const partial_summary = build_summary({
        started_at,
        finished_at: new Date().toISOString(),
        user_id,
        albums_list_ok,
        albums_total_from_api,
        album_metas,
        track_sections,
        errors,
        albums_skipped_resume,
      });
      persist_library_backup({
        saved_albums_doc: build_saved_albums_doc(
          user_id,
          albums_total_from_api,
          album_metas,
          albums_list_ok
        ),
        album_tracks_doc: build_album_tracks_doc(user_id, track_sections),
        summary_doc: partial_summary,
        checkpoint_doc,
      });
    }
  }

  const finished_at = new Date().toISOString();
  const stats = count_track_stats(track_sections);

  let final_ok = 0;
  let final_failed = 0;
  let final_pending = 0;
  for (let i = 0; i < album_metas.length; i += 1) {
    const st = album_metas[i].tracks_read_status;
    if (st === 'ok') {
      final_ok += 1;
    } else if (st === 'failed') {
      final_failed += 1;
    } else {
      final_pending += 1;
    }
  }

  const library_albums_backup_complete =
    albums_list_ok &&
    final_failed === 0 &&
    final_pending === 0 &&
    errors.length === 0 &&
    (typeof albums_total_from_api !== 'number' ||
      album_metas.length === albums_total_from_api);

  const summary_doc = build_summary({
    started_at,
    finished_at,
    user_id,
    albums_list_ok,
    albums_total_from_api,
    album_metas,
    track_sections,
    errors,
    albums_skipped_resume,
    library_albums_backup_complete,
    stats,
    albums_tracks_ok: final_ok,
    albums_tracks_failed: final_failed,
    albums_tracks_pending: final_pending,
  });

  const payload = {
    saved_albums_doc: build_saved_albums_doc(
      user_id,
      albums_total_from_api,
      album_metas,
      albums_list_ok
    ),
    album_tracks_doc: build_album_tracks_doc(user_id, track_sections),
    summary_doc,
    checkpoint_doc: build_checkpoint(
      albums_total_from_api,
      album_metas,
      track_sections
    ),
  };

  persist_library_backup(payload);
  return summary_doc;
}

function build_saved_albums_doc(user_id, total, album_metas, list_ok) {
  return {
    schema_version: SCHEMA_VERSION,
    backed_up_at: new Date().toISOString(),
    source_api: 'GET /v1/me/albums',
    user_id,
    albums_list_ok: list_ok,
    albums_total_from_api: total,
    albums: album_metas,
  };
}

function build_album_tracks_doc(user_id, sections) {
  return {
    schema_version: SCHEMA_VERSION,
    backed_up_at: new Date().toISOString(),
    source_api: 'GET /v1/albums/{id}/tracks',
    user_id,
    albums: sections,
  };
}

function build_checkpoint(total, metas, sections) {
  const completed = [];
  for (let i = 0; i < metas.length; i += 1) {
    const m = metas[i];
    const s = sections[i];
    if (m && m.album_id && is_album_tracks_complete(m, s)) {
      completed.push(m.album_id);
    }
  }
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    albums_total_from_api: total,
    completed_album_ids: completed,
  };
}

function build_summary(params) {
  const stats =
    params.stats || count_track_stats(params.track_sections || []);
  return {
    schema_version: SCHEMA_VERSION,
    library_albums_backup_complete:
      params.library_albums_backup_complete === true,
    note: '僅代表收藏專輯備份範圍，不代表整個 Spotify 音樂庫已完成備份。',
    started_at: params.started_at,
    finished_at: params.finished_at,
    user_id: params.user_id,
    counts: {
      albums_total_from_api: params.albums_total_from_api,
      albums_in_backup: (params.album_metas || []).length,
      albums_tracks_ok: params.albums_tracks_ok || 0,
      albums_tracks_failed: params.albums_tracks_failed || 0,
      albums_tracks_pending: params.albums_tracks_pending || 0,
      albums_skipped_resume: params.albums_skipped_resume || 0,
      total_track_entries: stats.total_track_entries,
      unique_track_ids: stats.unique_track_ids,
    },
    errors: params.errors || [],
  };
}

export function print_library_backup_summary(summary) {
  const c = summary.counts || {};
  console.log('\n========== 收藏專輯備份摘要 ==========');
  console.log(`API 收藏專輯 total：${c.albums_total_from_api ?? '?'}`);
  console.log(`備份專輯數：${c.albums_in_backup ?? 0}`);
  console.log(`曲目讀取成功：${c.albums_tracks_ok ?? 0}`);
  console.log(`曲目讀取失敗：${c.albums_tracks_failed ?? 0}`);
  console.log(`未完成／pending：${c.albums_tracks_pending ?? 0}`);
  console.log(`中斷續傳跳過：${c.albums_skipped_resume ?? 0}`);
  console.log(`專輯曲目總筆數：${c.total_track_entries ?? 0}`);
  console.log(`不重複 Track ID：${c.unique_track_ids ?? 0}`);
  console.log(
    `library_albums_backup_complete：${summary.library_albums_backup_complete ? '是' : '否'}`
  );
  if (summary.errors && summary.errors.length) {
    console.log(`錯誤紀錄：${summary.errors.length} 筆（詳見 library-summary.json）`);
  }
  console.log('========================================\n');
}
