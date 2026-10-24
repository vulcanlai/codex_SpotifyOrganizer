/**
 * 第六階段 E：100 首測試樣本匯出（排除 v2 30 首）
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  FILE_AI_SAMPLE,
  FILE_CLASSIFICATION_INDEX,
  AI_SAMPLE_SCHEMA_VERSION,
} from './paths.js';
import { write_json_atomic } from '../atomic_json.js';
import {
  select_ai_sample_track_ids,
  primary_artist_name,
  decade_from_tags,
  album_key,
} from './ai_sample_select.js';
import { AiExportError } from './ai_export.js';
import {
  PHASE_E_DIR,
  FILE_PHASE_E_SAMPLE,
  FILE_PHASE_E_SAMPLE_SUMMARY,
  FILE_PHASE_E_SELECTION_MANIFEST,
  PHASE_E_TARGET_COUNT,
  TEST_BATCH_PHASE_E_100,
  FILE_PHASE_E_CURSOR_PROGRESS,
} from './ai_test_batches.js';
import { write_phase_e_cursor_chunks } from './phase_e_cursor_chunks.js';

function read_index() {
  if (!fs.existsSync(FILE_CLASSIFICATION_INDEX)) {
    throw new AiExportError(
      '缺少 classification-index.json，請先執行 npm run classify:build。'
    );
  }
  return JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8'));
}

function sample_track_payload(track_row) {
  const disp = track_row.display || {};
  return {
    spotify_id: track_row.spotify_id,
    name: disp.name,
    artists: disp.artists || [],
    album_name: disp.album_name || null,
    release_date: disp.release_date || null,
    release_date_precision: disp.release_date_precision || null,
    existing_tags: track_row.tags || [],
    metadata_status: track_row.metadata_status,
  };
}

function count_by_field(tracks_by_id, ids, fn) {
  const out = {};
  for (let i = 0; i < ids.length; i += 1) {
    const key = fn(tracks_by_id[ids[i]]);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function count_unique_artists(tracks_by_id, ids) {
  const set = {};
  for (let i = 0; i < ids.length; i += 1) {
    set[primary_artist_name(tracks_by_id[ids[i]])] = true;
  }
  return Object.keys(set).length;
}

/**
 * @param {object} opts
 */
export function export_phase_e_sample(opts) {
  const options = opts || {};
  const count =
    typeof options.count === 'number' ? options.count : PHASE_E_TARGET_COUNT;
  const index_doc = options.index_doc || read_index();
  const tracks_by_id = index_doc.tracks_by_id || {};

  let exclude_ids = options.exclude_ids || [];
  if (!exclude_ids.length && fs.existsSync(FILE_AI_SAMPLE)) {
    const v2 = JSON.parse(fs.readFileSync(FILE_AI_SAMPLE, 'utf8'));
    exclude_ids = v2.track_ids || [];
  }

  const selection = select_ai_sample_track_ids(tracks_by_id, count, {
    exclude_ids,
  });

  if (!selection.ok) {
    return {
      ok: false,
      selection,
      sample_doc: null,
      reason: selection.reason,
    };
  }

  const tracks = [];
  for (let i = 0; i < selection.selected_ids.length; i += 1) {
    const id = selection.selected_ids[i];
    tracks.push(sample_track_payload(tracks_by_id[id]));
  }

  const exported_at = new Date().toISOString();
  const sample_id = crypto
    .createHash('sha256')
    .update('phase-e-100|' + selection.selected_ids.join('|'))
    .digest('hex')
    .slice(0, 16);

  const sample_doc = {
    schema_version: AI_SAMPLE_SCHEMA_VERSION,
    test_batch_id: TEST_BATCH_PHASE_E_100,
    exported_at,
    sample_id,
    requested_count: count,
    track_count: tracks.length,
    track_ids: selection.selected_ids,
    tracks,
    excluded_v2_sample_count: exclude_ids.length,
  };

  const summary_doc = {
    schema_version: AI_SAMPLE_SCHEMA_VERSION,
    test_batch_id: TEST_BATCH_PHASE_E_100,
    exported_at,
    sample_id,
    eligible_count: selection.eligible_count,
    selected_count: tracks.length,
    decades: count_by_field(tracks_by_id, selection.selected_ids, decade_from_tags),
    unique_artists: count_unique_artists(tracks_by_id, selection.selected_ids),
    unique_albums: count_by_field(
      tracks_by_id,
      selection.selected_ids,
      album_key
    ),
  };

  const manifest = {
    schema_version: 1,
    test_batch_id: TEST_BATCH_PHASE_E_100,
    created_at: exported_at,
    sample_id,
    rules: [
      '有效 Spotify Track ID',
      'metadata_status=complete 且有歌名與主藝人',
      '排除 v2 sample-30 曲目',
      'Track ID 不重複',
      '年代輪選 + 同藝人最多 2 首（與 v2 選取演算法相同）',
      '不因曲風預設篩選',
    ],
    excluded_track_ids: exclude_ids,
    eligible_pool: selection.eligible_count,
    selected_count: selection.selected_ids.length,
    track_ids: selection.selected_ids,
  };

  const progress_doc = {
    schema_version: 1,
    test_batch_id: TEST_BATCH_PHASE_E_100,
    updated_at: exported_at,
    sample_id,
    total_tracks: tracks.length,
    chunks_total: Math.ceil(tracks.length / 20),
    ai_completed_track_ids: [],
    ai_pending_track_ids: selection.selected_ids.slice(),
    note: '僅列入 ai-candidates-imported 的曲目視為已完成 Cursor AI 分析',
  };

  if (options.write !== false) {
    fs.mkdirSync(PHASE_E_DIR, { recursive: true });
    write_json_atomic(FILE_PHASE_E_SAMPLE, sample_doc);
    write_json_atomic(FILE_PHASE_E_SAMPLE_SUMMARY, summary_doc);
    write_json_atomic(FILE_PHASE_E_SELECTION_MANIFEST, manifest);
    write_json_atomic(FILE_PHASE_E_CURSOR_PROGRESS, progress_doc);
    write_phase_e_cursor_chunks(tracks, { sample_id, exported_at });
  }

  return {
    ok: true,
    sample_doc,
    summary_doc,
    manifest,
    selection,
  };
}
