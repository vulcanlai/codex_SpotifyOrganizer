
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {create_g3_fixture} from './g3_fixture.js';
import {assert_g3_f_dry_reconcile_pending,read_latest_f_wave_remaining_count,assert_disjoint_wave_ids} from './g3_f_pending_assert.js';
export async function register_g3_f_cases(n){
 const f=create_g3_fixture();
 const {build_g3_f1_pending_queue:queue}=await f.load('classification/g3_f/g3_f1_queue.js');
 const {select_g3_f_wave:select}=await f.load('classification/g3_f/g3_f1_wave_select.js');
 const {load_prior_g3_f_wave_track_ids:prior}=await f.load('classification/g3_f/g3_f_prior_waves.js');
 const {discover_g3_f_wave_sample_entries:discover}=await f.load('classification/g3_f/g3_f_wave_manifest.js');
 const specModule=await f.load('classification/g3_f/g3_f'+n+'_wave_spec.js');
 const paths=await f.load('classification/g3_f/paths_f'+n+'.js');
 const cfg={seed:paths['G3_F'+n+'_WAVE_SEED'],wave_id:'g3-f'+n+'-wave-100',wave_size:100,batch_size:10,batch_id_prefix:'fixture-f'+n+'-',cohort:'fixture'};
 const save=(number,ids,remaining=0)=>{const dir='backup/classification/g3-f'+number+'-wave-'+ids.length;f.write(dir+'/wave-sample-'+ids.length+'.json',{tracks:ids.map(track_id=>({track_id})),track_count:ids.length});f.write(dir+'/remaining-after-wave.json',{remaining_count:remaining});};
 test('F.'+n+': set difference excludes all discovered prior waves including F21',()=>{
  const ctx=f.context(140);save(1,ctx.all_ids.slice(0,10));save(21,ctx.all_ids.slice(10,20),120);
  const base=queue(ctx,{exclude_prior_f_waves:false});const result=queue(ctx,{exclude_prior_f_waves:true});
  assert.equal(prior().ids.size,20);assert.ok(discover().some(e=>e.wave_id==='g3-f21-wave-10'));
  assert_g3_f_dry_reconcile_pending(result,base.pending_tracks.map(r=>r.track_id),prior().ids);
  assert.equal(read_latest_f_wave_remaining_count(discover),120);
 });
 test('F.'+n+': fixed input and seed select 100 unique eligible IDs',()=>{
  const ctx=f.context(140),q=queue(ctx);const a=select(q,cfg),b=select(q,cfg);
  assert.equal(a.track_count,100);assert.deepEqual(a.tracks,b.tracks);assert.equal(new Set(a.tracks.map(t=>t.track_id)).size,100);
  assert.ok(a.tracks.every(t=>q.pending_tracks.some(r=>r.track_id===t.track_id)));
  assert.equal(a.batches.length,10);assert.equal(a.batches.flatMap(b=>b.track_ids).length,100);
 });
 test('F.'+n+': short and empty queues never fabricate IDs',()=>{
  for(const count of [0,30]){const wave=select(queue(f.context(count)),cfg);assert.equal(wave.track_count,count);assert.equal(wave.tracks.length,count);assert.equal(wave.batch_count,Math.ceil(count/10));}
 });
 test('F.'+n+': overlapping waves and duplicate IDs are detected',()=>{
  const ids=f.context(2).all_ids;
  assert.throws(()=>assert_disjoint_wave_ids([{tracks:[ids[0]]},{tracks:[ids[0]]}]),/duplicate ID/);
  assert.throws(()=>assert_disjoint_wave_ids([{tracks:[ids[0],ids[0]]}]),/duplicate ID/);
  assert.doesNotThrow(()=>assert_disjoint_wave_ids([{tracks:[ids[0]]},{tracks:[ids[1]]}]));
 });
 test('F.'+n+': missing Agent output halts and keeps adopt disabled with clean inference input',async()=>{
  const ctx=f.context(30);const wave=select(queue(ctx),cfg);
  f.write('backup/classification/g3-evidence/evidence-index.json',{tracks:ctx.ev_tracks});
  const {FILE_G3_D4_MERGED_CANDIDATE_200}=await f.load('classification/g3_d/paths_d4.js');f.write(FILE_G3_D4_MERGED_CANDIDATE_200,{tracks:[]});
  const {run_g3_e_wave}=await f.load('classification/g3_e/run_g3_e_wave.js');
  const spec=specModule['g3_f'+n+'_wave_spec']();
  const r=run_g3_e_wave(spec,wave,{write:true});assert.equal(r.summary.halted,true);assert.equal(r.summary.adopt_disabled,true);assert.equal(r.summary.staged_count,0);
  const first=f.read(spec.batch_inputs_dir+'/'+wave.batches[0].batch_id+'-input.json');assert.ok(first.tracks.every(t=>t.review_only_suggestions==null));
 });
}
