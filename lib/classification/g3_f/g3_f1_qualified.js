/**
 * 合格 AI 候選索引（單次載入）
 */
import fs from 'node:fs';
import path from 'node:path';
import { G3_E1_STAGED_DIR } from '../g3_e/paths_e1.js';
import { G3_E2_STAGED_DIR } from '../g3_e/paths_e2.js';
import { G3_E3_STAGED_DIR } from '../g3_e/paths_e3.js';
import { FILE_G3_D4_MERGED_CANDIDATE_200 } from '../g3_d/paths_d4.js';
import { load_g3_b_ai_catalog } from '../g3_c/load_g3_b_ai_catalog.js';
import { validate_genre_profile_draft } from '../g3_b/rule_classify.js';
import { SUBGENRES_BY_CODE } from '../genre_taxonomy.js';

function row_schema_ok(row) {
  if (!row || !row.genre_profile) {
    return false;
  }
  if (!validate_genre_profile_draft(row.genre_profile)) {
    return false;
  }
  const primary = row.genre_profile.primary_genre;
  const subs = row.genre_profile.subgenres || [];
  for (let s = 0; s < subs.length; s += 1) {
    const code = subs[s];
    if (!SUBGENRES_BY_CODE[code]) {
      return false;
    }
    if (primary !== 'unknown' && SUBGENRES_BY_CODE[code].main !== primary) {
      return false;
    }
  }
  return true;
}

function absorb_staged_dir(dir, source, qualified_set, ai_staged_set) {
  if (!fs.existsSync(dir)) {
    return;
  }
  const files = fs.readdirSync(dir);
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    if (!f.endsWith('-staged.json') && !f.endsWith('-inference.json')) {
      continue;
    }
    const id = f.replace('-staged.json', '').replace('-inference.json', '');
    ai_staged_set.add(id);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const row = doc.inference || doc;
    if (row_schema_ok(row)) {
      qualified_set.add(id);
    }
  }
}

/**
 * @returns {{ qualified_set: Set<string>, ai_staged_set: Set<string>, catalog: object, d34_set: Set<string> }}
 */
export function load_g3_f1_qualified_index() {
  /** @type {Set<string>} */
  const qualified_set = new Set();
  /** @type {Set<string>} */
  const ai_staged_set = new Set();

  absorb_staged_dir(G3_E1_STAGED_DIR, 'e1', qualified_set, ai_staged_set);
  absorb_staged_dir(G3_E2_STAGED_DIR, 'e2', qualified_set, ai_staged_set);
  absorb_staged_dir(G3_E3_STAGED_DIR, 'e3', qualified_set, ai_staged_set);

  const catalog = load_g3_b_ai_catalog();
  const cat_ids = Object.keys(catalog.by_id);
  for (let c = 0; c < cat_ids.length; c += 1) {
    const id = cat_ids[c];
    const entry = catalog.by_id[id];
    if (entry && row_schema_ok(entry.row)) {
      qualified_set.add(id);
    }
  }

  /** @type {Set<string>} */
  const d34_set = new Set();
  if (fs.existsSync(FILE_G3_D4_MERGED_CANDIDATE_200)) {
    const merged = JSON.parse(fs.readFileSync(FILE_G3_D4_MERGED_CANDIDATE_200, 'utf8'));
    for (let m = 0; m < merged.tracks.length; m += 1) {
      const row = merged.tracks[m];
      if (row_schema_ok(row)) {
        qualified_set.add(row.track_id);
        d34_set.add(row.track_id);
      }
    }
  }

  return { qualified_set: qualified_set, ai_staged_set: ai_staged_set, catalog: catalog, d34_set: d34_set };
}
