import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create_g3_fixture } from './helpers/g3_fixture.js';
import { track_id } from './fixtures/g3_data.js';
const fixture = create_g3_fixture();

const { build_g3_d1_expansion_pool: pool } = await fixture.load('classification/g3_d/g3_d1_pool.js');
const { select_g3_d1_wave_ids: select } = await fixture.load('classification/g3_d/g3_d1_stratify.js');
const { build_expansion_plan_1895: plan } = await fixture.load('classification/g3_c/g3_c2_acceptance.js');
test('D1 and C2 agree on the same fixture universe', () => {
 const a=pool(),b=plan();assert.equal(a.g3_b_classified_count,100);assert.equal(a.pool_rows.length,300);assert.equal(a.needs_new_cursor_ai,b.needs_new_cursor_ai);assert.equal(a.titled_track_count,b.titled_track_count);
});
test('missing catalog never requeues reserved sample-100 IDs', () => {
 const p='backup/classification/g3-b-trial-30/ai-classification-draft.json';const d=fixture.read(p);d.tracks.shift();fixture.write(p,d);
 const a=pool(),b=plan();assert.equal(a.g3_b_classified_count,99);assert.equal(a.missing_sample_catalog_count,1);assert.equal(a.needs_new_cursor_ai,300);
 assert.deepEqual(a.missing_sample_catalog_ids,b.missing_sample_catalog_ids);assert.ok(!a.pool_rows.some(r=>r.track_id===track_id(0)));
 assert.ok(select(200).selected_ids.every(id=>!fixture.read('backup/classification/g3-b5-trial-100/sample-100.json').track_ids.includes(id)));
});
test('fixed seed selects 200 unique eligible IDs reproducibly', () => {
 const a=select(200),b=select(200);assert.deepEqual(a.selected_ids,b.selected_ids);assert.equal(a.selected_ids.length,200);assert.equal(new Set(a.selected_ids).size,200);
 const allowed=new Set(pool().pool_rows.map(r=>r.track_id));assert.ok(a.selected_ids.every(id=>allowed.has(id)));
});
test('short pool never fabricates IDs', () => {
 const p='backup/classification/classification-index.json';const d=fixture.read(p);d.tracks_by_id=Object.fromEntries(Object.entries(d.tracks_by_id).slice(0,105));fixture.write(p,d);
 const r=select(200);assert.equal(r.selected_ids.length,5);assert.equal(new Set(r.selected_ids).size,5);
});
