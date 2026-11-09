import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build_cleanup_preview as build, select_operations, simulate_operations, preview_sync, digest } from '../lib/cleanup/preview.js';
const id = 'A'.repeat(22), p1 = 'B'.repeat(22), p2 = 'C'.repeat(22), album = 'D'.repeat(22);
function lib() { return { schema_version: 2, user_id: 'offline-user', saved_albums: [{ album_id: album }],
  playlist_track_entries: [], liked_tracks: [], track_index_by_spotify_id: { [id]: { spotify_id: id, name: 'Song', artists: ['Artist'],
  playability_status: 'unknown', appearances: [
    { kind: 'playlist', playlist_id: p1, position: 0 }, { kind: 'playlist', playlist_id: p1, position: 2 },
    { kind: 'playlist', playlist_id: p2, position: 1 }, { kind: 'liked' }, { kind: 'saved_album', album_id: album }] } } }; }
const cache = (status = 'ok', state = 'playable') => ({ schema_version: 1, tracks_by_id: { [id]: {
  status, name: 'Song', artists: [{ name: 'Artist' }], album: { id: album }, playability_status: state } } });
test('正常及播放未知不誤判失效；來源不變', () => {
  const l = lib(), c = cache('ok', 'unknown'), before = digest({ l, c });
  assert.equal(build(l, c).candidates.length, 0); assert.equal(digest({ l, c }), before);
});
test('429、403、404、network、partial、授權與其他錯誤分開且不確定失效', () => {
  for (const status of ['rate_limited_429','forbidden_403','not_found_404','network_error','partial','unauthorized_401','service_error']) {
    const r = build(lib(), cache(status, 'unknown'));
    assert.equal(r.summary.categories[status], 1); assert.equal(r.candidates[0].classification, 'needs_confirmation');
  }
});
test('不可播放、受限需重新確認；重複歌曲單獨統計', () => {
  for (const state of ['not_playable','restricted']) {
    const r = build(lib(), cache('ok',state));
    assert.equal(r.summary.recorded_unavailable, 1); assert.equal(r.summary.definitely_invalid_now,0);
    assert.equal(r.summary.duplicate_relations.length,1);
  }
});
test('多歌單、按讚及專輯僅依明確選取範圍操作；不重複刪除', () => {
  const r = build(lib(), cache('partial'));
  assert.equal(r.candidates[0].saved_album,true); assert.equal(r.summary.liked_affected,1);
  assert.equal(select_operations(r).length,0);
  const ops = select_operations(r,{ ids:[id], playlist_ids:[p1], liked:true });
  assert.equal(ops.length,2); assert.deepEqual(ops.find(x=>x.kind==='playlist').positions,[0,2]);
  assert.ok(ops.every(x=>x.kind!=='saved_album' && x.container_id!==p2));
});
test('無效 ID、部分成功缺失關鍵資訊與版本不符', () => {
  const l=lib(); l.track_index_by_spotify_id.bad={name:null,artists:[],appearances:[]};
  const r=build(l,cache()); assert.ok(r.candidates[0].reasons.includes('invalid_id'));
  assert.equal(select_operations(r,{ids:['bad'],liked:true}).length,0);
  assert.throws(()=>build({...l,schema_version:3},cache()));
  assert.throws(()=>build(l,{schema_version:2,tracks_by_id:{}}));
  assert.throws(()=>build({schema_version:2},cache()));
});
test('中途429錯誤停止、冷卻紀錄、續跑不重複；只允許離線 adapter', async () => {
  const ops=select_operations(build(lib(),cache('partial')),{playlist_ids:[p1,p2],liked:true});
  let calls=0;
  const adapter={offline:true,revalidate:async()=>true,verify:async()=>true,remove:async()=>{if(++calls===2)throw Object.assign(new Error('冷卻'),{status:429,retry_after:120});}};
  const r=await simulate_operations(ops,adapter); assert.equal(r.stopped,true);assert.equal(calls,2);
  assert.equal(r.log[1].retry_after,120); assert.equal(r.completed.length,1);
  let resumed=0; const rr=await simulate_operations(ops,{...adapter,remove:async()=>{resumed++;}},{completed:r.completed});
  assert.equal(rr.stopped,false);assert.equal(resumed,2);
  await assert.rejects(()=>simulate_operations(ops,{offline:false}));
});
test('位置改變或後驗證失敗即停止', async () => {
  const ops=select_operations(build(lib(),cache('partial')),{playlist_ids:[p1]});
  let called=false;
  const r=await simulate_operations(ops,{offline:true,revalidate:async()=>false,remove:async()=>{called=true;},verify:async()=>true});
  assert.equal(r.stopped,true);assert.equal(called,false);
  const r2=await simulate_operations(ops,{offline:true,revalidate:async()=>true,remove:async()=>{},verify:async()=>false});
  assert.equal(r2.stopped,true);assert.equal(r2.completed.length,0);
});
function sync_fixture() {
  const local=lib(), incoming=structuredClone(local);
  incoming.track_index_by_spotify_id[id].appearances=incoming.track_index_by_spotify_id[id].appearances.filter(a=>a.playlist_id!==p1);
  const ledger={schema_version:1,user_id:local.user_id,events:[{kind:'playlist',container_id:p1,spotify_id:id,status:'applied_verified',
    operation_id:'offline-op',verified_at:'2026-11-05T00:00:00Z',source_bundle_id:'offline-bundle'}]};
  return {local,incoming,ledger};
}
test('公司刪除只影響指定歌單，家裡獨有與按讚、專輯保留', () => {
  const {local,incoming,ledger}=sync_fixture();
  incoming.track_index_by_spotify_id[id].appearances=incoming.track_index_by_spotify_id[id].appearances.filter(a=>a.playlist_id!==p2);
  const r=preview_sync(local,incoming,ledger);
  assert.equal(r.removals_requiring_confirmation.length,1);
  assert.equal(r.protected_local_only[0].container_id,p2);
  assert.equal(r.retained_album_relations.length,1);assert.equal(r.apply_supported,false);
});
test('未驗證紀錄、來源復活、來源帳號不同、版本不符均停止', () => {
  const {local,incoming,ledger}=sync_fixture();
  assert.throws(()=>preview_sync(local,local,ledger));
  const candidate=structuredClone(ledger);candidate.events[0].status='simulated_verified';
  assert.throws(()=>preview_sync(local,incoming,candidate));
  assert.throws(()=>preview_sync(local,{...incoming,user_id:'other'},ledger));
  assert.throws(()=>preview_sync(local,incoming,{...ledger,schema_version:9}));
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup_import_safety } from '../lib/data_sync/cleanup_import_safety.js';
test('匯入安全閘保護家裡獨有、刪除紀錄、資料損毀與版本不符', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'so-cleanup-test-'));
  const local=path.join(root,'local'),incoming=path.join(root,'incoming');
  const write=(r,v)=>{fs.mkdirSync(path.join(r,'backup/merged'),{recursive:true});fs.writeFileSync(path.join(r,'backup/merged/library-v2.json'),JSON.stringify(v));};
  try {
    const f=sync_fixture();write(local,f.local);write(incoming,f.incoming);
    assert.equal(cleanup_import_safety(local,incoming).allow_apply,false);
    write(incoming,f.local);assert.equal(cleanup_import_safety(local,incoming).allow_apply,true);
    write(incoming,{...f.local,schema_version:9});assert.equal(cleanup_import_safety(local,incoming).allow_apply,false);
    fs.writeFileSync(path.join(incoming,'backup/merged/library-v2.json'),'{broken');
    assert.equal(cleanup_import_safety(local,incoming).allow_apply,false);
    write(incoming,f.local);fs.mkdirSync(path.join(local,'backup/library'),{recursive:true});
    fs.writeFileSync(path.join(local,'backup/library/cleanup-ledger.json'),JSON.stringify(f.ledger));
    assert.equal(cleanup_import_safety(local,incoming).allow_apply,false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

import { build_batch_plan, simulate_batch_plan, preview_manual_results } from '../lib/cleanup/preview.js';
const ownerPlaylists = [{id:p1,name:'他人歌單',owner_id:'other',collaborative:false},{id:p2,name:'自有歌單',owner_id:'offline-user',collaborative:false}];
test('整批含全部異常；非本人歌單不可自動移除，僅授權後人工隱藏',()=>{
  const p=build_batch_plan(lib(),cache('partial'),ownerPlaylists,{albums_known:true});
  assert.equal(p.summary.unique_tracks,1);assert.equal(p.summary.desired_playlist_relations,2);
  assert.equal(p.summary.desired_playlist_occurrences,3);assert.equal(p.summary.liked_relations,1);
  assert.equal(p.summary.api_ready,0);assert.equal(p.summary.api_potential_after_authorization,2);
  assert.equal(p.summary.not_editable_original_relations,1);
  assert.equal(p.operations.find(x=>x.container_id===p1).capability,'not_editable_by_current_account');
  assert.equal(p.batch_approval.approve_individual_tracks,false);
});
test('整批模擬只改投影，保留正常歌曲／專輯／快取；拒絕被修改計畫',()=>{
  const l=lib();const normal='N'.repeat(22);
  l.track_index_by_spotify_id[normal]={spotify_id:normal,name:'正常',artists:['正常藝人'],appearances:[{kind:'playlist',playlist_id:p1,position:9}]};
  l.playlist_track_entries=[{spotify_id:id,playlist_id:p1,position:0},{spotify_id:normal,playlist_id:p1,position:9}];
  const c=cache('partial'),before=digest({l,c});
  const p=build_batch_plan(l,c,ownerPlaylists,{albums_known:true});
  const r=simulate_batch_plan(l,c,ownerPlaylists,p);
  assert.equal(r.hypothetical_removed_occurrences,4);assert.equal(r.normal_tracks_unchanged,1);
  assert.deepEqual(r.projected_library.track_index_by_spotify_id[id].appearances,[{kind:'saved_album',album_id:album}]);
  assert.equal(r.projected_library.playlist_track_entries.length,1);assert.equal(digest({l,c}),before);
  const altered=structuredClone(p);altered.operations[0].spotify_id=normal;
  assert.throws(()=>simulate_batch_plan(l,c,ownerPlaylists,altered));
});
test('播放未知但無異常不進整批；429及partial可整批而無須重試',()=>{
  assert.equal(build_batch_plan(lib(),cache('ok','unknown'),ownerPlaylists).summary.unique_tracks,0);
  for(const status of ['rate_limited_429','partial','forbidden_403','not_found_404','network_error'])
    assert.equal(build_batch_plan(lib(),cache(status,'unknown'),ownerPlaylists).summary.unique_tracks,1);
});
test('隱藏、失敗、未找到不當成移除；紀錄需核對目標與依據',()=>{
  const p=build_batch_plan(lib(),cache('partial'),ownerPlaylists);
  const op=p.operations[0];
  const row={operation_id:op.operation_id,spotify_id:op.spotify_id,container_id:op.container_id,status:'hidden_verified',observed_at:'2026-11-05T00:00:00Z',evidence:'離線測試：核對歌曲與歌單 ID'};
  const receipt={schema_version:1,plan_id:p.plan_id,results:[row]};
  const r=preview_manual_results(p,receipt);
  assert.equal(r.hidden_verified.length,1);assert.equal(r.removed_verified.length,0);assert.equal(r.pending.length,2);
  assert.throws(()=>preview_manual_results(p,{...receipt,results:[{...row,spotify_id:p2}]}));
  assert.throws(()=>preview_manual_results(p,{...receipt,results:[row,row]}));
  assert.throws(()=>preview_manual_results(p,{...receipt,results:[{...row,evidence:''}]}));
  assert.equal(preview_manual_results(p,{...receipt,results:[{...row,status:'failed'}]}).stopped,true);
});
test('隱藏事件不准作刪除 tombstone；沒有共同基準須標示未準備好',()=>{
  const {local,incoming,ledger}=sync_fixture();
  assert.equal(preview_sync(local,incoming,ledger).requires_common_baseline,true);
  const hide=structuredClone(ledger);hide.events[0].action='hide';
  assert.throws(()=>preview_sync(local,incoming,hide));
  const bad=structuredClone(ledger);bad.events[0].verified_at='invalid';
  assert.throws(()=>preview_sync(local,incoming,bad));
});
test('共同基準保護家裡新增及改動；來源復活仍拒絕',()=>{
  const {local,incoming,ledger}=sync_fixture();
  const baseline=structuredClone(local);
  const r=preview_sync(local,incoming,ledger,{baseline});assert.equal(r.requires_common_baseline,false);assert.equal(r.conflicts.length,0);
  local.track_index_by_spotify_id[id].appearances[0].position=20;
  assert.equal(preview_sync(local,incoming,ledger,{baseline}).conflicts.length,1);
  const before=structuredClone(incoming);
  assert.equal(preview_sync(local,incoming,ledger,{baseline:before}).conflicts.length,1);
  assert.throws(()=>preview_sync(local,local,ledger,{baseline}));
});
