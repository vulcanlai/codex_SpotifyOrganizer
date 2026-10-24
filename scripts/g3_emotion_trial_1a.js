/**
 * G3 情緒 Phase 1A：80 首固定抽樣＋證據盤點（唯讀來源，寫入試驗目錄）
 * node scripts/g3_emotion_trial_1a.js
 * node scripts/g3_emotion_trial_1a.js --dry-run
 */
import { run_emotion_trial_1a_export } from '../lib/classification/g3_emotion/emotion_trial_1a_export.js';
import { EMOTION_TRIAL_1A_DIR } from '../lib/classification/g3_emotion/emotion_trial_paths.js';

const dry_run = process.argv.indexOf('--dry-run') >= 0;

const result = run_emotion_trial_1a_export({ write: !dry_run });

console.log('seed:', result.selection.seed);
console.log('tracks:', result.rows.length);
console.log('direct_audio:', result.summary.has_direct_audio_evidence_count);
console.log('reliable_lyrics:', result.summary.has_reliable_lyric_evidence_count);
console.log('evidence_insufficient:', result.summary.evidence_insufficient_count);
if (!dry_run) {
  console.log('輸出目錄:', EMOTION_TRIAL_1A_DIR);
}
