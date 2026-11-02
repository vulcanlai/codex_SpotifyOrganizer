/** 本機補全狀態；只讀取來源，不啟動補全或 OAuth。 */
import fs from 'node:fs';
import { load_library_v2_for_probe } from '../probe/library_v2_select.js';
import { load_track_cache, count_cache_stats } from './storage.js';
import { build_enrichment_queue } from './queue.js';
import { FILE_TRACK_CACHE } from './paths.js';
import { format_taiwan_datetime, format_taiwan_retry_time } from '../taiwan_time.js';
import {
  read_rate_limit_state_doc, validate_rate_limit_state_doc, format_remaining_duration,
} from './rate_limit_state.js';

/** 僅使用已保存且可驗證的期限；不回填、不從快取或查詢時間推估。 */
export function build_api_cooldown_status(state, now_ms = Date.now()) {
  if (state == null) return { status: 'missing' };
  try {
    validate_rate_limit_state_doc(state);
  } catch (err) {
    return { status: 'unknown', reason: `冷卻紀錄格式錯誤：${err.message}` };
  }
  if (state.retry_after_inferred === true || state.historical_event_time_unknown === true) {
    return { status: 'unknown', reason: '既有紀錄為推估或觀測時間不可靠，無可靠截止時間。' };
  }
  const remaining_ms = Math.max(0, Date.parse(state.retry_not_before) - now_ms);
  return {
    status: remaining_ms > 0 ? 'active' : 'expired',
    deadline: state.retry_not_before, remaining_ms,
  };
}

function load_api_cooldown_status(now_ms) {
  try {
    return build_api_cooldown_status(read_rate_limit_state_doc(), now_ms);
  } catch (err) {
    return { status: 'unknown', reason: `無法讀取或驗證冷卻紀錄：${err.message}` };
  }
}

function format_api_cooldown_status(cooldown = { status: 'missing' }) {
  const reliable = cooldown.status === 'active' || cooldown.status === 'expired';
  return [
    '', 'Spotify API 冷卻狀態',
    `目前是否冷卻中：${reliable ? (cooldown.status === 'active' ? '是' : '否') : '未知'}`,
    ...(!reliable ? [cooldown.status === 'missing' ? '無有效冷卻紀錄' : cooldown.reason] : []),
    `冷卻截止時間：${reliable ? format_taiwan_datetime(cooldown.deadline) : '未知'}`,
    `建議重新執行時間：${reliable ? format_taiwan_retry_time(cooldown.deadline, { minute_only: false }) : '未知'}`,
    `尚需等待：${reliable ? format_remaining_duration(cooldown.remaining_ms) : '未知'}`,
    ...(cooldown.status === 'expired' ? ['冷卻已結束，可以重新嘗試執行。'] : []),
  ];
}

function assert_index(index, label) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    throw new Error(`${label} 必須是物件。`);
  }
  for (const [id, row] of Object.entries(index)) {
    if (!id || !row || typeof row !== 'object' || Array.isArray(row) ||
        (row.spotify_id != null && row.spotify_id !== id)) {
      throw new Error(`${label} 含無效歌曲列或 Spotify ID 不一致：${id}`);
    }
  }
}

function known_playability(row) {
  const status = row?.playability_status;
  return ['playable', 'not_playable', 'restricted'].includes(status) ? status : null;
}

export function build_enrichment_status(track_index, cache_doc, now_ms = Date.now()) {
  assert_index(track_index, 'V2 索引');
  assert_index(cache_doc?.tracks_by_id, '快取索引');
  // 既有佇列需要 spotify_id；以索引鍵為準，且不修改來源物件。
  const normalized = Object.fromEntries(Object.entries(track_index).map(
    ([id, row]) => [id, { ...row, spotify_id: id }]
  ));
  const queue = build_enrichment_queue(normalized, cache_doc, now_ms, undefined, { phase: 'normal' });
  const total = Object.keys(normalized).length;
  const completed = queue.skipped_v2_has_meta + queue.skipped_cache_ok;
  const playback = { playable: 0, not_playable: 0, unknown: 0 };
  for (const [id, row] of Object.entries(normalized)) {
    // 明確已知的 API 快取優先；未知或缺少狀態時回退至 V2 明確狀態。
    // 不從 is_playable、available_markets 或舊版推導欄位猜測。
    const status = known_playability(cache_doc.tracks_by_id[id]) || known_playability(row);
    if (status === 'playable') playback.playable += 1;
    else if (status) playback.not_playable += 1;
    else playback.unknown += 1;
  }
  return {
    total, completed, completion_percent: total ? completed / total * 100 : 0,
    normal_pending: queue.normal_pending,
    anomalous_pending: queue.anomalous_pending,
    deferred_anomalies: queue.deferred_anomalies,
    cooldown_anomalies: queue.cooldown_anomalies,
    remaining_total: queue.remaining_total,
    playback, cache: count_cache_stats(cache_doc), updated_at: cache_doc.updated_at ?? null,
  };
}

export function load_enrichment_status(now_ms = Date.now()) {
  let track_index;
  try {
    ({ track_index } = load_library_v2_for_probe());
  } catch (err) {
    throw new Error(`無法讀取 V2 音樂庫或合併摘要：${err.message}`);
  }
  // 原 loader 對缺檔回傳空快取；查詢應明確報錯，不能讓缺檔看似零筆。
  if (!fs.existsSync(FILE_TRACK_CACHE)) throw new Error(`缺少快取檔案：${FILE_TRACK_CACHE}`);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(FILE_TRACK_CACHE, 'utf8'));
  } catch (err) {
    throw new Error(`無法讀取或解析 ${FILE_TRACK_CACHE}：${err.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('快取文件必須是物件。');
  const cache_doc = load_track_cache();
  if (cache_doc.updated_at != null && !Number.isFinite(Date.parse(cache_doc.updated_at))) {
    throw new Error('快取 updated_at 時間格式錯誤。');
  }
  return {
    ...build_enrichment_status(track_index, cache_doc, now_ms),
    api_cooldown: load_api_cooldown_status(now_ms),
  };
}

export function format_enrichment_status(s) {
  return [
    '歌曲補全進度',
    `音樂庫歌曲總數（Spotify ID 去重）：${s.total}`,
    `已完成 Metadata 補全：${s.completed}`,
    `完成率：${s.completion_percent.toFixed(2)}%`,
    `正常待補全：${s.normal_pending}`,
    `異常未完成：${s.anomalous_pending}`,
    `延後處理的異常：${s.deferred_anomalies}`,
    `冷卻中的異常：${s.cooldown_anomalies}`,
    `全部剩餘待補全：${s.remaining_total}`,
    '', '播放狀態統計（全音樂庫）',
    `已知可播放：${s.playback.playable}`,
    `已知不可播放／受限：${s.playback.not_playable}`,
    `播放狀態未知：${s.playback.unknown}`,
    '', '快取統計（本機全部快取）',
    `完整成功：${s.cache.cache_ok_complete}`,
    `403：${s.cache.cache_forbidden_403}`,
    `404：${s.cache.cache_not_found_404}`,
    `429：${s.cache.cache_rate_limited_429}`,
    `network：${s.cache.cache_network_error}`,
    `partial：${s.cache.cache_partial}`,
    `其他異常：${s.cache.cache_other}`,
    `快取總數：${s.cache.cached_entries}`,
    `快取最後更新時間：${s.updated_at == null ? '未知（未記錄）' : format_taiwan_datetime(s.updated_at)}`,
    ...format_api_cooldown_status(s.api_cooldown),
  ].join('\n');
}
