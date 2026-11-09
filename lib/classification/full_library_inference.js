import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {MAIN_GENRES} from './genre_taxonomy.js';
import {CLASSIFICATION_DIR} from './paths.js';
export const FILE_FULL_LIBRARY_INFERENCE=path.join(CLASSIFICATION_DIR,'full-library-inference.json');
export const metadata_fingerprint=row=>createHash('sha256').update(JSON.stringify([row.display?.name,row.display?.artists,row.display?.album_name])).digest('hex');
export function load_full_library_inference(file=FILE_FULL_LIBRARY_INFERENCE) {
  if(!fs.existsSync(file))return null;
  const d=JSON.parse(fs.readFileSync(file,'utf8'));
  if(d.schema_version!==1||!d.tracks_by_id||!Array.isArray(d.excluded_track_ids))throw new Error('全庫 AI 推論文件格式不符');
  return d;
}
export function apply_full_library_inference(row,doc,{manual_protected=false}={}) {
  if(!doc)return row;
  const next=structuredClone(row);
  if(doc.excluded_track_ids.includes(row.spotify_id))next.cleanup_exclusion={exclude_from_smart_playlists:true,source:doc.exclusion_source};
  const d=doc.tracks_by_id[row.spotify_id];
  if(!d||manual_protected||metadata_fingerprint(row)!==d.metadata_fingerprint)return next;
  if(row.genre_profile?.primary_genre && row.genre_profile.primary_genre!=='unknown')return next;
  const g=MAIN_GENRES.find(x=>x.code===d.primary_genre);
  next.ai_inference={source:'codex_metadata_group_inference',method:d.method,confidence_tier:d.confidence_tier,
    needs_review:true,evidence:d.evidence,status:'ai_suggested',group_artist:d.group_artist};
  if(g) {
    next.genre_profile={...row.genre_profile,primary_genre:g.code,subgenres:[],secondary_genres:[],
      source:'full-library-inference.json',confidence:'inferred'};
    next.tags=next.tags.filter(t=>t.dimension!=='genre'||t.is_manual_override);
    next.tags.push({dimension:'genre',value:g.label_zh,source:'codex_metadata_group_inference',method:d.method,
      confidence:'inferred',evidence:d.evidence,is_manual_override:false});
  }
  if(d.language && d.language!=='未確認'&&!next.tags.some(t=>t.dimension==='language'&&t.value!=='未確認')) {
    next.tags=next.tags.filter(t=>t.dimension!=='language');
    next.tags.push({dimension:'language',value:d.language,source:'codex_metadata_group_inference',method:d.method,
      confidence:'inferred',evidence:'語言為群組層級粗推論，可能有翻唱、雙語或器樂例外；需人工確認。',is_manual_override:false});
  }
  return next;
}

/** 只把同帳號新發現曲目加入派生索引；原始曲庫與既有ID永不覆寫。 */
export function merge_additional_inference_tracks(track_index, doc, user_id) {
  const extra=doc?.additional_track_index_by_id;
  if(!extra)return track_index;
  if(!user_id||doc.additional_tracks_user_id!==user_id)throw new Error("新增曲目來源帳號不符");
  if(typeof extra!=="object"||Array.isArray(extra))throw new Error("新增曲目來源格式不符");
  const merged={...track_index};
  for(const [id,row] of Object.entries(extra)){
    if(!/^[A-Za-z0-9]{22}$/.test(id)||row?.spotify_id!==id||row.uri!=="spotify:track:"+id||!row.name||!Array.isArray(row.artists)||!row.artists.length)throw new Error("新增曲目ID或Metadata不符");
    if(!Object.hasOwn(merged,id))merged[id]=structuredClone(row);
  }
  return merged;
}
