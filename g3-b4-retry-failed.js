/**
 * 補匯入子曲風修正後的失敗曲目
 */
import fs from 'fs';
import path from 'path';
import { import_g3_b_ai_draft } from './lib/classification/g3_b/import_ai_draft.js';
import { validate_g3_b_ai_draft } from './lib/classification/g3_b/validate_ai_draft.js';
import { G3_B3_BATCH_DRAFTS_DIR } from './lib/classification/g3_b/paths_b3.js';
import { write_json_atomic } from './lib/atomic_json.js';
import { file_g3_evidence_index } from './lib/classification/g3_evidence/paths.js';

const retries = [
  {
    batch_id: 'g3b3-batch-01',
    track_id: '07BLMnpZYg6RT0H1elobry',
    draft: 'backup/classification/g3-b4-trial-30/cursor-drafts/g3b3-batch-01.json',
  },
  {
    batch_id: 'g3b3-batch-04',
    track_id: '1Ehdm1PDlKrdfyBsjwEvd1',
    draft: 'backup/classification/g3-b4-trial-30/cursor-drafts/g3b3-batch-04.json',
  },
];

const ev = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks;

for (let i = 0; i < retries.length; i += 1) {
  const r = retries[i];
  const doc = JSON.parse(fs.readFileSync(r.draft, 'utf8'));
  const row = doc.tracks.find(function (t) {
    return t.track_id === r.track_id;
  });
  validate_g3_b_ai_draft(
    { tracks: [row] },
    { allowed_track_ids: [r.track_id], evidence_by_id: ev }
  );
  const pack = import_g3_b_ai_draft(
    { tracks: [row], source: doc.source },
    { write: false, allowed_track_ids: [r.track_id] }
  );
  const imported_path = path.join(G3_B3_BATCH_DRAFTS_DIR, r.batch_id + '-imported.json');
  const existing = JSON.parse(fs.readFileSync(imported_path, 'utf8'));
  existing.tracks = existing.tracks.filter(function (t) {
    return t.track_id !== r.track_id;
  });
  existing.tracks.push(pack.tracks[0]);
  write_json_atomic(imported_path, existing);
  console.log('merged', r.track_id);
}
