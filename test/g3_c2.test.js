import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create_g3_fixture } from './helpers/g3_fixture.js';
import { track_id } from './fixtures/g3_data.js';
const fixture = create_g3_fixture();

const { run_g3_c1_build: build } = await fixture.load('classification/g3_c/run_g3_c1_build.js');
const { analyze_sample_100_preview_gap: gap, build_expansion_plan_1895: plan } = await fixture.load('classification/g3_c/g3_c2_acceptance.js');
test('balanced includes 90 and excludes exactly 10 low-tier fixture rows', () => {
 build({write:true});const g=gap();assert.equal(g.sample_total,100);assert.equal(g.included_in_balanced_empty_filter,90);assert.equal(g.excluded_count,10);assert.equal(g.data_loss_detected,false);
 assert.ok(g.excluded_tracks.every(t=>t.exclusion_category==='balanced_policy_low_confidence_tier'&&t.ai_confidence_tier==='low'));
 assert.equal(new Set([...g.included_track_ids,...g.excluded_tracks.map(t=>t.spotify_id)]).size,100);
});
test('catalog gaps remain program errors rather than low-tier exclusions', () => {
 const p='backup/classification/g3-b6-trial-100/batch-drafts/fixture-imported.json';const d=fixture.read(p);d.tracks.splice(0,7);fixture.write(p,d);
 build({write:true});const g=gap();assert.equal(g.included_in_balanced_empty_filter,83);assert.equal(g.excluded_count,17);assert.equal(g.data_loss_detected,true);
 assert.equal(g.excluded_tracks.filter(t=>t.exclusion_category==='program_error').length,7);
});
test('classified missing and new-work counts reconcile independently', () => {
 const p='backup/classification/g3-b-trial-30/ai-classification-draft.json';const d=fixture.read(p);d.tracks.shift();fixture.write(p,d);
 const r=plan();assert.equal(r.titled_track_count,400);assert.equal(r.g3_b_classified_count,99);assert.equal(r.missing_sample_catalog_count,1);assert.deepEqual(r.missing_sample_catalog_ids,[track_id(0)]);assert.equal(r.needs_new_cursor_ai,300);
 assert.equal(r.g3_b_classified_count+r.missing_sample_catalog_count+r.reusable_ai_outside_g3_b+r.needs_new_cursor_ai,r.titled_track_count);
});
