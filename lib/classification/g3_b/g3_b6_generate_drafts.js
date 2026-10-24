/**
 * 產生 G3-B.6 十批 Cursor 草稿 JSON
 */
import fs from 'fs';
import path from 'path';
import { build_track_payloads_for_ids } from './export_ai_input_b6.js';
import { infer_g3_b6_draft_row } from './g3_b6_infer_draft.js';
import { G3_B6_CURSOR_DRAFTS_DIR } from './paths_b6.js';
import { FILE_G3_B5_BATCH_PLAN } from './paths_b5.js';
import { subgenres_for_main, MAIN_GENRES } from '../genre_taxonomy.js';

function main_map() {
  const out = {};
  for (let i = 0; i < MAIN_GENRES.length; i += 1) {
    const code = MAIN_GENRES[i].code;
    out[code] = subgenres_for_main(code).map(function (r) {
      return r.code;
    });
  }
  return out;
}

export function generate_all_g3_b6_drafts(opts) {
  const options = opts || {};
  const write = options.write !== false;
  const plan = JSON.parse(fs.readFileSync(FILE_G3_B5_BATCH_PLAN, 'utf8'));
  if (write) {
    fs.mkdirSync(G3_B6_CURSOR_DRAFTS_DIR, { recursive: true });
  }
  const sub_map = main_map();
  /** @type {Record<string, string>} */
  const written = {};
  for (let b = 0; b < plan.batches.length; b += 1) {
    const batch = plan.batches[b];
    const payloads = build_track_payloads_for_ids(batch.track_ids);
    const tracks = payloads.map(function (p) {
      return infer_g3_b6_draft_row(p);
    });
    const doc = {
      schema_version: 1,
      source: 'cursor_agent_g3_b6',
      batch_id: batch.batch_id,
      model_note:
        'G3-B.6 Cursor Agent 推理；G3-A evidence-index；含 main_to_allowed_subgenres',
      main_to_allowed_subgenres: sub_map,
      tracks: tracks,
    };
    if (write) {
      const fp = path.join(G3_B6_CURSOR_DRAFTS_DIR, batch.batch_id + '.json');
      fs.writeFileSync(fp, JSON.stringify(doc, null, 2), 'utf8');
    }
    written[batch.batch_id] = tracks.length;
  }
  return { batches: written, total: Object.values(written).reduce((a, n) => a + n, 0) };
}
