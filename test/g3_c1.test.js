import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create_g3_fixture } from './helpers/g3_fixture.js';
import { track_id } from './fixtures/g3_data.js';
const fixture = create_g3_fixture();

const { run_g3_c1_build: build } = await fixture.load('classification/g3_c/run_g3_c1_build.js');
const { load_unified_classification_view: load } = await fixture.load('classification/g3_c/build_unified_view.js');
const { FILE_G3_C1_FIELD_TASKS } = await fixture.load('classification/g3_c/paths_c1.js');
import fs from 'node:fs';
test('unified view preserves 400 unique IDs and integrates 100 AI rows', () => {
 const r=build({write:true});const d=load();assert.equal(r.summary.track_count,400);
 assert.equal(Object.keys(d.tracks).length,400);assert.equal(d.g3_ai_integrated_in_sample_100,100);
 assert.equal(new Set(Object.keys(d.tracks)).size,d.track_count);
});
test('31 evidence-required rows match generated task sources', () => {
 const r=build({write:true});assert.equal(r.needs_evidence_tracks,31);
 const tasks=JSON.parse(fs.readFileSync(FILE_G3_C1_FIELD_TASKS,'utf8'));
 assert.equal(tasks.needs_evidence_track_count,31);assert.equal(tasks.task_count,tasks.tasks.length);assert.ok(tasks.task_count>0);
 const d=load();for(const t of tasks.tasks){const id=t.track_id||t.spotify_id;assert.ok(d.tracks[id]);assert.ok(['needs_evidence','conflict'].includes(d.tracks[id].auto_review_status));}
});
test('AI confirmed claims remain conflicts and cannot become confirmed facts', () => {
 const p='backup/classification/g3-b-trial-30/ai-classification-draft.json';const doc=fixture.read(p);doc.tracks[0].confidence='confirmed';fixture.write(p,doc);
 build({write:true});const row=load().tracks[track_id(0)];assert.equal(row.auto_review_status,'conflict');assert.notEqual(row.primary_genre.confidence,'confirmed');assert.ok(row.conflicts.length);
});
test('catalog gap remains visible without fabricated integration', () => {
 const p='backup/classification/g3-b-trial-30/ai-classification-draft.json';const doc=fixture.read(p);doc.tracks.shift();fixture.write(p,doc);
 build({write:true});const d=load();assert.equal(d.g3_ai_integrated_in_sample_100,99);assert.ok(d.tracks[track_id(0)]);assert.equal(d.tracks[track_id(0)].auto_review_status,null);
});
