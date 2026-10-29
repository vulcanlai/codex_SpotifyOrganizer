import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create_g3_fixture } from './helpers/g3_fixture.js';
import { track_id } from './fixtures/g3_data.js';
const fixture = create_g3_fixture();

const { build_g3_b6_merged_quality_report_100: report } = await fixture.load('classification/g3_b/merged_quality_report_100.js');
const { load_g3_b_ai_catalog: catalog } = await fixture.load('classification/g3_c/load_g3_b_ai_catalog.js');
test('complete fixture covers 100 sample IDs from 30 plus 70 imports', () => {
 const r=report({write:false});assert.equal(r.sample_size,100);assert.equal(r.counts.ai_processed_total,100);
 assert.equal(r.counts.newly_generated_g3_b6,70);assert.equal(r.counts.reused_g3_b1,10);
 assert.deepEqual(new Set(r.per_track.map(t=>t.track_id)),new Set(catalog().sample_100_ids));
});
test('seven catalog gaps remain incomplete and retain sample rows', () => {
 const p='backup/classification/g3-b6-trial-100/batch-drafts/fixture-imported.json';const doc=fixture.read(p);doc.tracks.splice(0,7);fixture.write(p,doc);
 const r=report({write:false});assert.equal(r.counts.ai_processed_total,93);assert.equal(r.per_track.length,100);
 assert.equal(r.per_track.filter(t=>t.ai_source===null).length,7);
});
test('duplicate source IDs count once', () => {
 const p='backup/classification/g3-b6-trial-100/batch-drafts/fixture-imported.json';const doc=fixture.read(p);doc.tracks.push(doc.tracks[0]);fixture.write(p,doc);
 assert.equal(report({write:false}).counts.ai_processed_total,100);assert.equal(Object.keys(catalog().by_id).length,100);
});
test('report writes only fixture output and preserves source', () => {
 const p='backup/classification/g3-b-trial-30/ai-classification-draft.json';const before=fixture.read(p);
 report({write:true});assert.deepEqual(fixture.read(p),before);
 assert.equal(fixture.read('backup/classification/g3-b6-trial-100/merged-quality-report-100.json').counts.ai_processed_total,100);
});
