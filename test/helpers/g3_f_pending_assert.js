
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
// Discover through the production loader; no historical numeric fallback.
export function read_latest_f_wave_remaining_count(discover) {
 const entries=discover().slice().sort((a,b)=>Number(b.wave_id.match(/g3-f(\d+)/)[1])-Number(a.wave_id.match(/g3-f(\d+)/)[1]));
 for(const e of entries){const file=path.join(path.dirname(e.file),'remaining-after-wave.json');if(fs.existsSync(file)){const d=JSON.parse(fs.readFileSync(file,'utf8'));if(Number.isInteger(d.remaining_count))return d.remaining_count;}}
 return null;
}
export function assert_g3_f_dry_reconcile_pending(queue,base_ids,prior_ids) {
 const expected=base_ids.filter(id=>!prior_ids.has(id)).sort();
 assert.deepEqual(queue.pending_tracks.map(r=>r.track_id).sort(),expected);
 assert.equal(queue.pending_count,expected.length);
 assert.equal(queue.excluded_prior_f_wave_track_count,base_ids.length-expected.length);
 assert.equal(new Set(queue.pending_tracks.map(r=>r.track_id)).size,expected.length);
}
export function assert_disjoint_wave_ids(waves){const seen=new Set();for(const wave of waves){for(const t of wave.tracks){const id=t.track_id||t;assert.ok(!seen.has(id),'wave duplicate ID: '+id);seen.add(id);}}}
