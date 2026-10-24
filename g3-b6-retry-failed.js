/**
 * G3-B.6 補匯入單首失敗
 */
import fs from 'fs';
import path from 'path';
import { import_g3_b_ai_draft } from './lib/classification/g3_b/import_ai_draft.js';
import { validate_g3_b_ai_draft } from './lib/classification/g3_b/validate_ai_draft.js';
import { write_json_atomic } from './lib/atomic_json.js';
import { file_g3_evidence_index } from './lib/classification/g3_evidence/paths.js';
import { G3_B6_BATCH_DRAFTS_DIR, G3_B6_CURSOR_DRAFTS_DIR } from './lib/classification/g3_b/paths_b6.js';
import { generate_all_g3_b6_drafts } from './lib/classification/g3_b/g3_b6_generate_drafts.js';

generate_all_g3_b6_drafts({ write: true });

const retries = [
  { batch_id: 'g3b5-batch-05', track_id: '4FI0rdztOAYJZMupujL5Gp' },
  { batch_id: 'g3b5-batch-07', track_id: '5dNkiibfkr0xjebtJXV1ia' },
  { batch_id: 'g3b5-batch-08', track_id: '6ALtdfVnklY8xp9bUBKVEP' },
];

const ev = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks;

for (let i = 0; i < retries.length; i += 1) {
  const r = retries[i];
  const draft_path = path.join(G3_B6_CURSOR_DRAFTS_DIR, r.batch_id + '.json');
  const doc = JSON.parse(fs.readFileSync(draft_path, 'utf8'));
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
  const imported_path = path.join(G3_B6_BATCH_DRAFTS_DIR, r.batch_id + '-imported.json');
  const existing = JSON.parse(fs.readFileSync(imported_path, 'utf8'));
  existing.tracks = existing.tracks.filter(function (t) {
    return t.track_id !== r.track_id;
  });
  existing.tracks.push(pack.tracks[0]);
  write_json_atomic(imported_path, existing);
  console.log('merged', r.track_id);
}
