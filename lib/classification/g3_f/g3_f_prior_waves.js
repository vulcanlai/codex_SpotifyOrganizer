/**
 * 已完成 G3-F wave 的 track_id（供 F.2+ 佇列排除）
 */
import fs from 'node:fs';
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';
import { FILE_G3_F1_WAVE_100 } from './paths_f1.js';
import { FILE_G3_F2_WAVE_100 } from './paths_f2.js';
import { FILE_G3_F3_WAVE_100 } from './paths_f3.js';
import { FILE_G3_F4_WAVE_100 } from './paths_f4.js';
import { FILE_G3_F5_WAVE_100 } from './paths_f5.js';
import { FILE_G3_F6_WAVE_100 } from './paths_f6.js';
import { discover_g3_f_wave_sample_entries } from './g3_f_wave_manifest.js';

const WAVE_SAMPLE_FILES = [
  { wave_id: 'g3-f1-wave-100', file: FILE_G3_F1_WAVE_100, reason_zh: 'G3-F.1 已完成 staged wave' },
  { wave_id: 'g3-f2-wave-100', file: FILE_G3_F2_WAVE_100, reason_zh: 'G3-F.2 wave（若已 prepare）' },
  { wave_id: 'g3-f3-wave-100', file: FILE_G3_F3_WAVE_100, reason_zh: 'G3-F.3 wave（若已 prepare）' },
  { wave_id: 'g3-f4-wave-100', file: FILE_G3_F4_WAVE_100, reason_zh: 'G3-F.4 wave（若已 prepare）' },
  { wave_id: 'g3-f5-wave-100', file: FILE_G3_F5_WAVE_100, reason_zh: 'G3-F.5 wave（若已 prepare）' },
  { wave_id: 'g3-f6-wave-100', file: FILE_G3_F6_WAVE_100, reason_zh: 'G3-F.6 wave（若已 prepare）' },
];

/**
 * @returns {{ ids: Set<string>, waves: object[] }}
 */
export function load_prior_g3_f_wave_track_ids() {
  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {object[]} */
  const waves = [];
  /** @type {Record<string, boolean>} */
  const seen_files = {};

  /** @type {{ wave_id: string, file: string, reason_zh: string }[]} */
  const entries = WAVE_SAMPLE_FILES.slice();
  const discovered = discover_g3_f_wave_sample_entries();
  for (let d = 0; d < discovered.length; d += 1) {
    let dup = false;
    for (let e = 0; e < entries.length; e += 1) {
      if (entries[e].file === discovered[d].file) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      entries.push(discovered[d]);
    }
  }

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (seen_files[entry.file]) {
      continue;
    }
    if (!fs.existsSync(entry.file)) {
      continue;
    }
    const doc = JSON.parse(fs.readFileSync(entry.file, 'utf8'));
    const tracks = doc.tracks || [];
    /** @type {string[]} */
    const track_ids = [];
    for (let t = 0; t < tracks.length; t += 1) {
      const id = tracks[t].track_id || tracks[t];
      if (typeof id === 'string') {
        ids.add(id);
        track_ids.push(id);
      }
    }
    if (track_ids.length) {
      seen_files[entry.file] = true;
      waves.push({
        wave_id: entry.wave_id,
        track_count: track_ids.length,
        reason_zh: entry.reason_zh,
        sample_file: path.relative(CLASSIFICATION_DIR, entry.file).replace(/\\/g, '/'),
      });
    }
  }

  return { ids: ids, waves: waves };
}
