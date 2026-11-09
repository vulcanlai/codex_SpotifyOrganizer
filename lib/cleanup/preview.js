/**
 * 離線清理預覽；不載入 OAuth、不提供 Spotify 寫入實作。
 */
import { createHash } from 'node:crypto';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const valid_id = id => typeof id === 'string' && /^[A-Za-z0-9]{22}$/.test(id);
const known = x => ['playable', 'not_playable', 'restricted'].includes(x);
const key = x => JSON.stringify([x.kind, x.container_id ?? null, x.spotify_id]);
export function validate_library(doc) {
  if (doc?.schema_version !== 2 || !doc.track_index_by_spotify_id ||
      !Array.isArray(doc.playlist_track_entries) || !Array.isArray(doc.liked_tracks) ||
      !Array.isArray(doc.saved_albums) || typeof doc.user_id !== 'string' || !doc.user_id ||
      typeof doc.track_index_by_spotify_id !== 'object' || Array.isArray(doc.track_index_by_spotify_id))
    throw new Error('曲庫版本或必要資料不完整');
  for (const row of Object.values(doc.track_index_by_spotify_id)) {
    if (!row || typeof row !== 'object' || !Array.isArray(row.appearances) ||
        row.appearances.some(a => !a || !['playlist', 'liked', 'saved_album'].includes(a.kind)))
      throw new Error('曲庫歌曲關係不完整');
  }
}
export function relations(doc) {
  validate_library(doc);
  const rows = [];
  for (const [id, row] of Object.entries(doc.track_index_by_spotify_id)) {
    for (const a of row.appearances || []) {
      if (!['playlist', 'liked', 'saved_album'].includes(a.kind)) continue;
      rows.push({ kind: a.kind, container_id: a.kind === 'playlist' ? a.playlist_id :
        a.kind === 'saved_album' ? a.album_id : null, spotify_id: id,
        position: a.position ?? null, source: a.source ?? null });
    }
  }
  return rows;
}
export function build_cleanup_preview(library, cache, { playlists = [], albums_known = false } = {}) {
  validate_library(library);
  if (cache?.schema_version !== 1 || !cache.tracks_by_id) throw new Error('快取版本或內容不完整');
  const candidates = [], categories = {}, playback = { playable: 0, not_playable: 0, restricted: 0, unknown: 0 };
  const all = relations(library), duplicates = [], invalid_relations = [];
  const counts = new Map();
  for (const r of all) {
    if (!valid_id(r.spotify_id) || (r.kind !== 'liked' && !valid_id(r.container_id))) invalid_relations.push(r);
    const k = key(r); counts.set(k, (counts.get(k) || 0) + 1);
  }
  for (const [k, count] of counts) if (count > 1) duplicates.push({ relation: JSON.parse(k), count });
  for (const [id, row] of Object.entries(library.track_index_by_spotify_id)) {
    const c = cache.tracks_by_id[id];
    const state = known(c?.playability_status) ? c.playability_status :
      known(row.playability_status) ? row.playability_status : 'unknown';
    playback[state]++;
    const reasons = [];
    if (!valid_id(id)) reasons.push('invalid_id');
    if (row.spotify_id && row.spotify_id !== id) reasons.push('id_mismatch');
    if (['not_playable', 'restricted'].includes(state)) reasons.push(state);
    if (c && c.status !== 'ok') reasons.push(c.status || 'other_error');
    if (c?.status === 'ok' && (!c.name || !c.artists?.length || !c.album || (!c.album.id && !c.album.name)))
      reasons.push('partial');
    const name = c?.name || row.name;
    const artists = c?.artists?.length ? c.artists : row.artists;
    if (!name || !artists?.length) reasons.push('missing_key_metadata');
    if (!reasons.length) continue;
    const locations = all.filter(x => x.spotify_id === id);
    const apps = row.appearances || [];
    const album_ids = [...new Set(apps.filter(x => x.kind === 'saved_album').map(x => x.album_id).filter(Boolean))];
    const ps = [...new Set(apps.filter(x => x.kind === 'playlist').map(x => x.playlist_id))].map(pid => {
      const p = playlists.find(x => x.id === pid);
      return { playlist_id: pid, name: p?.name || apps.find(x => x.playlist_id === pid)?.playlist_name || null,
        writable: p?.ownership === 'owned' ? 'requires_live_check' : 'unknown_or_restricted' };
    });
    for (const reason of new Set(reasons)) categories[reason] = (categories[reason] || 0) + 1;
    candidates.push({ spotify_id: id, name: name || null,
      artists: (artists || []).map(a => typeof a === 'string' ? a : a.name || a.id),
      playlists: ps, liked: apps.some(x => x.kind === 'liked'),
      saved_album: album_ids.length ? true : albums_known ? false : 'unknown',
      saved_album_ids: album_ids, playability: state, enrichment_status: c?.status || 'no_cache',
      error_reason: c?.error_summary || null, http_status: c?.http_status ?? null,
      attempts: c?.attempts ?? null, repeated_failure: 'unknown_without_attempt_history',
      reasons: [...new Set(reasons)], classification: ['not_playable', 'restricted'].includes(state) ?
        'recorded_unavailable_requires_revalidation' : 'needs_confirmation',
      needs_manual_confirmation: true, recommended_scope: '僅人工勾選的個別關係；保留專輯及其他引用',
      locations, evidence: { library: 'backup/merged/library-v2.json', cache: c ? 'backup/enrichment/track-metadata-cache.json' : null,
        observed_at: c?.fetched_at || library.merged_at, appearances: apps } });
  }
  const by_playlist = {};
  for (const c of candidates) for (const p of c.playlists) {
    by_playlist[p.playlist_id] ||= { ...p, candidate_tracks: 0, occurrences: 0 };
    by_playlist[p.playlist_id].candidate_tracks++;
    by_playlist[p.playlist_id].occurrences += c.locations.filter(x => x.kind === 'playlist' && x.container_id === p.playlist_id).length;
  }
  return { schema_version: 1, mode: 'dry_run', source_fingerprint: digest({ library, cache }), candidates,
    summary: { total: Object.keys(library.track_index_by_spotify_id).length,
      without_anomaly: Object.keys(library.track_index_by_spotify_id).length - candidates.length,
      candidates: candidates.length, categories, playback,
      recorded_unavailable: candidates.filter(x => x.classification.startsWith('recorded_')).length,
      needs_confirmation: candidates.filter(x => x.classification === 'needs_confirmation').length,
      liked_affected: candidates.filter(x => x.liked).length,
      saved_album_tracks: candidates.filter(x => x.saved_album === true).length,
      saved_album_ids: [...new Set(candidates.flatMap(x => x.saved_album_ids))],
      by_playlist, duplicate_relations: duplicates, invalid_relations,
      unavailable_playlist_snapshots: playlists.filter(p => p.read_status !== 'ok').map(p => ({ id: p.id, name: p.name, read_status: p.read_status })),
      live_mutations: 0, definitely_invalid_now: 0 } };
}
export function select_operations(preview, { ids = [], playlist_ids = [], liked = false, types = [] } = {}) {
  if (!ids.length && !playlist_ids.length && !liked && !types.length) return [];
  const ops = new Map();
  for (const c of preview.candidates) {
    if (ids.length && !ids.includes(c.spotify_id)) continue;
    if (types.length && !types.some(t => c.reasons.includes(t))) continue;
    for (const r of c.locations) {
      if (!valid_id(r.spotify_id)) continue;
      if (r.kind === 'liked' && !liked) continue;
      if (r.kind === 'saved_album') continue;
      if (r.kind === 'playlist' && (!playlist_ids.includes(r.container_id) || !valid_id(r.container_id))) continue;
      const k = key(r);
      if (!ops.has(k)) ops.set(k, { ...r, positions: [], operation_id: digest([preview.source_fingerprint, k]),
        preconditions: ['fresh_account_and_scope_check', 'fresh_snapshot_and_position_check', 'manual_approval', 'verified_backup'],
        blocked: true });
      if (r.position != null) ops.get(k).positions.push(r.position);
    }
  }
  return [...ops.values()];
}
/** 僅接受離線 adapter；真實 API 不接入本階段。逐筆核對與錯誤停止。 */
export async function simulate_operations(ops, adapter, { batch_size = 20, completed = [] } = {}) {
  if (adapter?.offline !== true) throw new Error('本階段只允許離線模擬');
  if (!Number.isInteger(batch_size) || batch_size < 1 || batch_size > 100) throw new Error('無效批次大小');
  const done = new Set(completed), log = [];
  for (let i = 0; i < ops.length; i += batch_size) {
    for (const op of ops.slice(i, i + batch_size)) {
      if (done.has(op.operation_id)) continue;
      try {
        if (!await adapter.revalidate(op)) throw new Error('目標或位置已變更');
        await adapter.remove(op);
        if (!await adapter.verify(op)) throw new Error('移除後驗證失敗');
        done.add(op.operation_id);
        log.push({ operation_id: op.operation_id, status: 'simulated_verified', relation: op });
      } catch (e) {
        log.push({ operation_id: op.operation_id, status: 'stopped', http_status: e.status || null,
          retry_after: e.retry_after || null, message: e.message });
        return { mode: 'simulation', stopped: true, completed: [...done], log };
      }
    }
  }
  return { mode: 'simulation', stopped: false, completed: [...done], log };
}
/** 刪除紀錄只接受已實際完成且驗證的關係；模擬／候選不能成為 tombstone。 */
export function preview_sync(local, incoming, ledger, { baseline = null } = {}) {
  validate_library(local); validate_library(incoming);
  if (local.user_id !== incoming.user_id || !local.user_id) throw new Error('來源帳號不一致');
  if (ledger?.schema_version !== 1 || ledger.user_id !== incoming.user_id || !Array.isArray(ledger.events))
    throw new Error('刪除紀錄版本或帳號不符');
  const events = new Map();
  for (const e of ledger.events) {
    if ((e.action != null && e.action !== 'remove') || !Number.isFinite(Date.parse(e.verified_at)) || e.status !== 'applied_verified' || !e.operation_id || !e.verified_at || !e.source_bundle_id ||
        !['playlist', 'liked', 'saved_album', 'local_cache'].includes(e.kind) || !valid_id(e.spotify_id) ||
        (e.kind === 'playlist' && !valid_id(e.container_id))) throw new Error('未驗證或不完整刪除紀錄');
    if (['saved_album', 'local_cache'].includes(e.kind)) throw new Error('專輯與快取須分開審核，本階段不支援套用');
    if (events.has(key(e))) throw new Error('重複刪除紀錄');
    events.set(key(e), e);
  }
  const a = new Map(relations(local).map(r => [key(r), r]));
  const b = new Map(relations(incoming).map(r => [key(r), r]));
  for (const k of events.keys()) if (b.has(k)) throw new Error('來源仍含已刪除關係，停止以避免復活');
  const conflicts = [];
  if (baseline) {
    validate_library(baseline);
    if (baseline.user_id !== local.user_id) throw new Error('共同基準帳號不符');
    const before = relations(baseline), current = relations(local);
    for (const [k, event] of events) {
      const original = before.filter(r=>key(r)===k), now = current.filter(r=>key(r)===k);
      if (now.length && (!original.length || digest(original)!==digest(now)))
        conflicts.push({ event, reason:'家裡該關係自共同基準後新增或改動，保護並停止自動移除' });
    }
  }
  return { mode: 'preview_only', apply_supported: false,
    requires_common_baseline: events.size > 0 && !baseline, conflicts,
    source_fingerprints: { local: digest(local), incoming: digest(incoming), ledger: digest(ledger) },
    removals_requiring_confirmation: [...events].filter(([k]) => a.has(k)).map(([,v]) => v),
    protected_local_only: [...a].filter(([k]) => !b.has(k) && !events.has(k)).map(([,v]) => v),
    additions: [...b].filter(([k]) => !a.has(k) && !events.has(k)).map(([,v]) => v),
    retained_album_relations: [...a.values()].filter(r => r.kind === 'saved_album'),
    warning: '禁止使用整檔覆蓋匯入套用此預覽；需三方對帳與正式授權。' };
}

/** 整批清理：所有異常候選納入，權限與移除可行性另列，不再逐首要求確認。 */
export function build_batch_plan(library, cache, playlists, options = {}) {
  const preview = build_cleanup_preview(library, cache, { playlists, albums_known: options.albums_known === true });
  const groups = new Map(), candidates = preview.candidates;
  for (const c of candidates) for (const r of c.locations) {
    if (r.kind === 'saved_album') continue;
    const k = key(r);
    if (!groups.has(k)) {
      const p = playlists.find(p => p.id === r.container_id);
      const owned = Boolean(p?.owner_id && p.owner_id === library.user_id);
      const editable = r.kind === 'liked' || owned;
      groups.set(k, { ...r, operation_id: digest([preview.source_fingerprint, k]), name: c.name, artists: c.artists,
        reasons: c.reasons, positions_reference_only: [], playlist_name: p?.name || c.playlists.find(x=>x.playlist_id===r.container_id)?.name || null,
        playlist_url: r.kind === 'playlist' ? 'https://open.spotify.com/playlist/' + r.container_id : null,
        track_url: 'https://open.spotify.com/track/' + r.spotify_id,
        candidate: true, desired_action: 'remove', status: 'pending_batch_approval',
        capability: !valid_id(r.spotify_id) ? 'invalid_target' : editable ? 'api_requires_live_validation' :
          p?.collaborative ? 'collaborator_permission_unknown' : 'not_editable_by_current_account',
        api_ready: false, alternative: editable ? null : 'manual_hide_in_source_playlist',
        position_warning: r.source === 'manual_import' ? '僅匯入清單位置，不是 Spotify 即時位置' : '舊快照，執行前須重新核對',
        local_presence: {
          merged_appearances: c.locations.length,
          playlist_entries: library.playlist_track_entries.filter(x=>x.spotify_id===r.spotify_id && x.playlist_id===r.container_id).length,
          liked_entries: library.liked_tracks.filter(x=>x.spotify_id===r.spotify_id).length,
          saved_album_ids: c.saved_album_ids, cache_status: c.enrichment_status,
          preserve_metadata_and_original_backups: true
        } });
    }
    if (r.position != null) groups.get(k).positions_reference_only.push(r.position);
  }
  const operations = [...groups.values()];
  const by_playlist = Object.values(preview.summary.by_playlist).map(p => ({
    ...p, playlist_url: 'https://open.spotify.com/playlist/' + p.playlist_id,
    owned_by_current_account: playlists.find(x=>x.id===p.playlist_id)?.owner_id === library.user_id,
    collaborative: playlists.find(x=>x.id===p.playlist_id)?.collaborative ?? null,
    desired_removal_relations: operations.filter(x=>x.kind==='playlist'&&x.container_id===p.playlist_id).length
  }));
  const plan = { schema_version: 1, mode: 'preapproval', user_id: library.user_id,
    source_fingerprint: preview.source_fingerprint, policy: 'cleanup_first_all_anomaly_candidates', albums_known: options.albums_known === true,
    operations, candidates, by_playlist,
    summary: { unique_tracks: candidates.length, desired_playlist_relations: operations.filter(x=>x.kind==='playlist').length,
      desired_playlist_occurrences: operations.filter(x=>x.kind==='playlist').reduce((n,x)=>n+x.positions_reference_only.length,0),
      liked_relations: operations.filter(x=>x.kind==='liked').length,
      saved_album_changes: 0, saved_album_candidate_tracks: preview.summary.saved_album_tracks,
      api_ready: 0, api_potential_after_authorization: operations.filter(x=>x.capability==='api_requires_live_validation').length,
      not_editable_original_relations: operations.filter(x=>x.capability==='not_editable_by_current_account').length,
      unknown_or_invalid: operations.filter(x=>['invalid_target','collaborator_permission_unknown'].includes(x.capability)).length,
      manual_hide_candidates: operations.filter(x=>x.alternative==='manual_hide_in_source_playlist').length,
      metadata_failure_tracks: candidates.filter(x=>x.enrichment_status!=='ok').length,
      unknown_playability_only_excluded: true, live_changes: 0 },
    batch_approval: { required: true, approve_individual_tracks: false,
      desired: '整批處理列出的異常關係；有權限才移除；無權限時另明確核准隱藏替代方案',
      hidden_is_not_deleted: true, unfollow_whole_playlists: false, clear_metadata: false },
    backup: options.backup || null };
  return { ...plan, plan_id: digest(plan) };
}
/** 只在記憶體模擬已列出的移除關係；不代表線上可執行或成功。 */
export function simulate_batch_plan(library, cache, playlists, plan) {
  const expected = build_batch_plan(library, cache, playlists, { albums_known: plan.albums_known, backup: plan.backup });
  if (expected.plan_id !== plan.plan_id || digest({ ...plan, plan_id: undefined }) !==
      digest({ ...expected, plan_id: undefined })) throw new Error('計畫被修改或來源已變更');
  const target = new Set(plan.operations.map(key));
  const projected = structuredClone(library);
  let removed = 0;
  for (const [id,row] of Object.entries(projected.track_index_by_spotify_id)) {
    row.appearances = row.appearances.filter(a => {
      const r = { kind:a.kind, container_id:a.kind==='playlist'?a.playlist_id:a.kind==='saved_album'?a.album_id:null, spotify_id:id };
      if (target.has(key(r))) { removed++; return false; } return true;
    });
  }
  projected.playlist_track_entries = projected.playlist_track_entries.filter(x=>
    !target.has(key({kind:'playlist',container_id:x.playlist_id,spotify_id:x.spotify_id})));
  projected.liked_tracks = projected.liked_tracks.filter(x=>
    !target.has(key({kind:'liked',container_id:null,spotify_id:x.spotify_id})));
  const normal = Object.keys(library.track_index_by_spotify_id).filter(id=>!plan.candidates.some(c=>c.spotify_id===id));
  if (normal.some(id=>digest(library.track_index_by_spotify_id[id])!==digest(projected.track_index_by_spotify_id[id])) ||
      digest(library.saved_albums)!==digest(projected.saved_albums)) throw new Error('模擬影響範圍超出候選');
  return { mode:'simulation_only', live_changes:0, plan_id:plan.plan_id, hypothetical_removed_occurrences:removed,
    normal_tracks_unchanged:normal.length, saved_albums_unchanged:true, cache_unchanged:true,
    note:'假設有權限並已實際移除才可套用此投影；不是 Spotify 成功紀錄，不產生 tombstone。',
    projected_library:projected };
}

/** 人工結果只做稽核預覽；不套用曲庫，不把隱藏變成刪除。 */
export function preview_manual_results(plan, receipt) {
  if (receipt?.schema_version !== 1 || receipt.plan_id !== plan.plan_id || !Array.isArray(receipt.results))
    throw new Error('人工結果版本或計畫不符');
  const allowed = new Map(plan.operations.map(x=>[x.operation_id,x]));
  const seen = new Set(), result = { mode:'preview_only', plan_id:plan.plan_id, apply_supported:false,
    removed_verified:[], hidden_verified:[], not_found:[], failed:[], pending:[] };
  for (const row of receipt.results) {
    const op = allowed.get(row.operation_id);
    if (!op || seen.has(row.operation_id) || row.spotify_id!==op.spotify_id ||
        (row.container_id??null)!==(op.container_id??null) || !Object.hasOwn(result,row.status) ||
        !Array.isArray(result[row.status])) throw new Error('人工結果超出計畫、重複或狀態無效');
    seen.add(row.operation_id);
    if (['removed_verified','hidden_verified'].includes(row.status) &&
        (!Number.isFinite(Date.parse(row.observed_at)) || typeof row.evidence!=='string' || !row.evidence.trim()))
      throw new Error('已完成狀態缺少實際核對依據或時間');
    result[row.status].push(row);
  }
  for (const op of plan.operations) if (!seen.has(op.operation_id)) result.pending.push({
    operation_id:op.operation_id,spotify_id:op.spotify_id,container_id:op.container_id,status:'pending' });
  return { ...result, stopped:result.failed.length>0,
    next_action:'僅已移除並核實的關係可準備刪除同步紀錄；隱藏、未找到、失敗與 pending 都不是移除。此工具不修改正式資料。' };
}
