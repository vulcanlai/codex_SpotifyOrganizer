/**
 * 預覽單曲完整 G3 證據（離線）
 * npm run g3:evidence-preview -- <spotify_track_id>
 */
import fs from 'node:fs';
import { FILE_G3_EVIDENCE_INDEX } from './lib/classification/g3_evidence/paths.js';
import { build_g3_evidence_index } from './lib/classification/g3_evidence/build_evidence_index.js';

const track_id = process.argv[2];
if (!track_id) {
  console.error('用法: npm run g3:evidence-preview -- <spotify_track_id>');
  process.exit(1);
}

if (!fs.existsSync(FILE_G3_EVIDENCE_INDEX)) {
  build_g3_evidence_index({ write: true });
}

const doc = JSON.parse(fs.readFileSync(FILE_G3_EVIDENCE_INDEX, 'utf8'));
const row = doc.tracks[track_id];
if (!row) {
  console.error('找不到曲目:', track_id);
  process.exit(1);
}

console.log(JSON.stringify(row, null, 2));
