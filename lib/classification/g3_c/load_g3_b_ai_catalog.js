/**
 * 唯讀彙整 G3-B AI 草稿（不覆寫來源檔）
 */
import fs from 'node:fs';
import path from 'node:path';
import { FILE_G3_B1_AI_DRAFT_READONLY } from '../g3_b/paths_b2.js';
import { G3_B3_BATCH_DRAFTS_DIR } from '../g3_b/paths_b3.js';
import { G3_B6_BATCH_DRAFTS_DIR } from '../g3_b/paths_b6.js';
import { G3_D1_BATCH_DRAFTS_DIR } from '../g3_d/paths_d1.js';
import { FILE_G3_B5_SAMPLE_100 } from '../g3_b/paths_b5.js';
import { FILE_G3_D1_SAMPLE_200 } from '../g3_d/paths_d1.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function load_dir_imports(dir, source_label) {
  /** @type {Record<string, object>} */
  const by_id = {};
  if (!fs.existsSync(dir)) {
    return by_id;
  }
  const files = fs.readdirSync(dir).filter(function (f) {
    return f.endsWith('-imported.json');
  });
  for (let i = 0; i < files.length; i += 1) {
    const doc = read_json(path.join(dir, files[i]));
    if (!doc || !doc.tracks) {
      continue;
    }
    for (let t = 0; t < doc.tracks.length; t += 1) {
      const row = doc.tracks[t];
      by_id[row.track_id] = { row: row, source: source_label };
    }
  }
  return by_id;
}

const AI_SOURCE_PRIORITY = {
  g3_d1_batch: 5,
  g3_b6_batch: 4,
  g3_b4_batch: 3,
  g3_b1_ai_draft: 2,
};

/**
 * @returns {{ by_id: Record<string, { row: object, source: string }>, sample_100_ids: string[], sample_200_ids: string[] }}
 */
export function load_g3_b_ai_catalog() {
  const sample_doc = read_json(FILE_G3_B5_SAMPLE_100);
  const sample_100_ids = sample_doc && sample_doc.track_ids ? sample_doc.track_ids.slice() : [];
  const sample_d1 = read_json(FILE_G3_D1_SAMPLE_200);
  const sample_200_ids = sample_d1 && sample_d1.track_ids ? sample_d1.track_ids.slice() : [];

  /** @type {Record<string, { row: object, source: string, priority: number }>} */
  const merged = {};

  const d1 = load_dir_imports(G3_D1_BATCH_DRAFTS_DIR, 'g3_d1_batch');
  const b6 = load_dir_imports(G3_B6_BATCH_DRAFTS_DIR, 'g3_b6_batch');
  const b4 = load_dir_imports(G3_B3_BATCH_DRAFTS_DIR, 'g3_b4_batch');
  const b1_doc = read_json(FILE_G3_B1_AI_DRAFT_READONLY);
  const b1 = {};
  if (b1_doc && b1_doc.tracks) {
    for (let i = 0; i < b1_doc.tracks.length; i += 1) {
      const row = b1_doc.tracks[i];
      b1[row.track_id] = { row: row, source: 'g3_b1_ai_draft' };
    }
  }

  function absorb(map) {
    const ids = Object.keys(map);
    for (let j = 0; j < ids.length; j += 1) {
      const id = ids[j];
      const entry = map[id];
      const pri = AI_SOURCE_PRIORITY[entry.source] || 0;
      if (!merged[id] || pri > merged[id].priority) {
        merged[id] = {
          row: entry.row,
          source: entry.source,
          priority: pri,
        };
      }
    }
  }

  absorb(b1);
  absorb(b4);
  absorb(b6);
  absorb(d1);

  const by_id = {};
  const mids = Object.keys(merged);
  for (let m = 0; m < mids.length; m += 1) {
    const id = mids[m];
    by_id[id] = { row: merged[id].row, source: merged[id].source };
  }

  return { by_id: by_id, sample_100_ids: sample_100_ids, sample_200_ids: sample_200_ids };
}
