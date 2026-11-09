import {test} from 'node:test';import assert from 'node:assert/strict';
import {apply_full_library_inference,metadata_fingerprint} from '../lib/classification/full_library_inference.js';
import {build_mvp_playlist_catalog} from '../lib/classification/mvp_smart_playlists.js';
const id='A'.repeat(22);
const row=()=>({spotify_id:id,display:{name:'測試歌',artists:['測試藝人'],album_name:'測試專輯'},tags:[{dimension:'language',value:'未確認'},{dimension:'genre',value:'未確認'}],genre_profile:{primary_genre:'unknown',subgenres:[],secondary_genres:[]}});
const doc=r=>({excluded_track_ids:[],exclusion_source:'test',tracks_by_id:{[id]:{metadata_fingerprint:metadata_fingerprint(r),primary_genre:'rock',language:'國語',confidence_tier:'medium',method:'artist_group_metadata_review',evidence:'離線測試推論'}}});
test('AI 推論只更新未知分類且不標成已確認',()=>{const r=row(),before=JSON.stringify(r);const out=apply_full_library_inference(r,doc(r));assert.equal(out.genre_profile.primary_genre,'rock');assert.equal(out.genre_profile.confidence,'inferred');assert.equal(out.ai_inference.status,'ai_suggested');assert.ok(out.tags.every(t=>t.confidence!=='confirmed'));assert.equal(JSON.stringify(r),before);});
test('人工與既有已採用曲風保留',()=>{const r=row();assert.deepEqual(apply_full_library_inference(r,doc(r),{manual_protected:true}),r);const old={...r,genre_profile:{primary_genre:'jazz',confidence:'inferred'}};assert.deepEqual(apply_full_library_inference(old,doc(old)),old);});
test('Metadata 改變就不套用舊推論',()=>{const r=row(),d=doc(r);r.display.name='另一首';assert.deepEqual(apply_full_library_inference(r,d),r);});
test('異常排除只影響歌單派生，保留索引與Metadata',()=>{const r=row(),d=doc(r);d.excluded_track_ids=[id];const out=apply_full_library_inference(r,d);assert.equal(out.display.name,r.display.name);assert.equal(out.cleanup_exclusion.exclude_from_smart_playlists,true);const catalog=build_mvp_playlist_catalog({tracks_by_id:{[id]:out}});assert.equal(catalog.language_genre_playlists.length,0);assert.equal(catalog.emotion_playlists_tentative.length,0);});
test('不能判定曲風時仍是unknown，不自動預設流行',()=>{const r=row(),d=doc(r);d.tracks_by_id[id].primary_genre='unknown';const out=apply_full_library_inference(r,d);assert.equal(out.genre_profile.primary_genre,'unknown');});

import {resolve_formal_classification_state} from '../lib/classification/classification_state.js';
test('全庫推論在介面標成ai_suggested而非confirmed',()=>{
 assert.equal(resolve_formal_classification_state({index_genre_profile:{primary_genre:'rock'},index_full_library_inference:{source:'codex_metadata_group_inference'}}),'ai_suggested');
 assert.equal(resolve_formal_classification_state({index_genre_profile:{primary_genre:'unknown'},index_full_library_inference:{source:'codex_metadata_group_inference'}}),'unknown');
});
test('缺少主曲風不得誤標成AI已建議分類',()=>{assert.equal(resolve_formal_classification_state({index_genre_profile:{},index_full_library_inference:{source:'codex_metadata_group_inference'}}),'unknown');});

import {merge_additional_inference_tracks} from '../lib/classification/full_library_inference.js';
test('新增來源只補新ID且不改動原曲庫',()=>{const base={[id]:{name:'人工原資料'}},extra={spotify_id:id,uri:'spotify:track:'+id,name:'來源新名稱',artists:['藝人']},d={additional_tracks_user_id:'u',additional_track_index_by_id:{[id]:extra}};assert.deepEqual(merge_additional_inference_tracks(base,d,'u'),base);const fresh=merge_additional_inference_tracks({},d,'u');assert.equal(fresh[id].name,'來源新名稱');fresh[id].name='另改';assert.equal(extra.name,'來源新名稱');});
test('新增來源拒絕跨帳號與無效ID',()=>{assert.throws(()=>merge_additional_inference_tracks({},{additional_tracks_user_id:'other',additional_track_index_by_id:{}},'u'));assert.throws(()=>merge_additional_inference_tracks({},{additional_tracks_user_id:'u',additional_track_index_by_id:{bad:{spotify_id:'bad'}}},'u'));});
