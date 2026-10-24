/**
 * G3-D.3 修復試驗執行
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { build_d1_lineage_200, build_catalog_source_overlay } from './g3_d3_lineage.js';
import { select_g3_d3_repair_sample_30 } from './g3_d3_sample_30.js';
import {
  G3_D3_AGENT_REPAIR_TRACKS,
  main_to_allowed_subgenres_map,
} from './g3_d3_agent_repair_drafts.js';
import { compare_d1_d2_d3 } from './g3_d3_compare.js';
import { simulate_d3_adoption_preview } from './g3_d3_preview_simulation.js';
import { G3_D1_BATCH_DRAFTS_DIR, G3_D1_BATCH_INPUTS_DIR } from './paths_d1.js';
import path from 'node:path';
import {
  G3_D3_REPAIR_DIR,
  FILE_G3_D3_LINEAGE_200,
  FILE_G3_D3_CATALOG_SOURCE_OVERLAY,
  FILE_G3_D3_SAMPLE_30,
  FILE_G3_D3_AGENT_DRAFTS_30,
  FILE_G3_D3_COMPARISON,
  FILE_G3_D3_PREVIEW_SIMULATION,
  FILE_G3_D3_OFFLINE_SUMMARY,
  FILE_G3_D3_INPUT_30,
} from './paths_d3.js';

function load_d1_by_id() {
  /** @type {Record<string, object>} */
  const by_id = {};
  const files = fs.readdirSync(G3_D1_BATCH_DRAFTS_DIR).filter(function (f) {
    return f.endsWith('-imported.json');
  });
  for (let i = 0; i < files.length; i += 1) {
    const doc = JSON.parse(
      fs.readFileSync(path.join(G3_D1_BATCH_DRAFTS_DIR, files[i]), 'utf8')
    );
    for (let t = 0; t < doc.tracks.length; t += 1) {
      by_id[doc.tracks[t].track_id] = doc.tracks[t];
    }
  }
  return by_id;
}

function export_payloads_30(ids) {
  /** @type {Record<string, object>} */
  const map = {};
  const files = fs.readdirSync(G3_D1_BATCH_INPUTS_DIR).filter(function (f) {
    return f.endsWith('-input.json');
  });
  for (let i = 0; i < files.length; i += 1) {
    const doc = JSON.parse(
      fs.readFileSync(path.join(G3_D1_BATCH_INPUTS_DIR, files[i]), 'utf8')
    );
    for (let p = 0; p < (doc.evidence_payloads || []).length; p += 1) {
      map[doc.evidence_payloads[p].track_id] = doc.evidence_payloads[p];
    }
  }
  const out = [];
  for (let j = 0; j < ids.length; j += 1) {
    out.push(map[ids[j]] || null);
  }
  return out;
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function run_g3_d3_repair(opts) {
  const options = opts || {};
  const write = options.write !== false;

  const lineage = build_d1_lineage_200();
  const overlay = build_catalog_source_overlay(lineage);
  const by_id = load_d1_by_id();
  const sample = select_g3_d3_repair_sample_30({ by_id: by_id });

  if (G3_D3_AGENT_REPAIR_TRACKS.length !== sample.actual_total) {
    throw new Error(
      'Agent 草稿數 ' +
        G3_D3_AGENT_REPAIR_TRACKS.length +
        ' 與樣本 ' +
        sample.actual_total
    );
  }

  const sample_ids = sample.tracks.map(function (t) {
    return t.track_id;
  });
  const d1_rows = sample_ids.map(function (id) {
    return by_id[id];
  });

  const agent_doc = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: 'cursor_agent_g3_d3_repair',
    model_note: 'G3-D.3 Cursor Agent 逐首推理；非 g3:d1-generate-drafts',
    main_to_allowed_subgenres: main_to_allowed_subgenres_map(),
    tracks: G3_D3_AGENT_REPAIR_TRACKS,
  };

  const comparison = compare_d1_d2_d3(d1_rows, G3_D3_AGENT_REPAIR_TRACKS, sample);
  const d3_by = {};
  for (let a = 0; a < G3_D3_AGENT_REPAIR_TRACKS.length; a += 1) {
    d3_by[G3_D3_AGENT_REPAIR_TRACKS[a].track_id] = G3_D3_AGENT_REPAIR_TRACKS[a];
  }
  const preview_sim = simulate_d3_adoption_preview(d3_by);

  const summary = {
    schema_version: 1,
    generated_at: agent_doc.generated_at,
    lineage_counts: lineage.counts,
    agent_repair_success: G3_D3_AGENT_REPAIR_TRACKS.length,
    comparison_stats: comparison.stats,
    preview_simulation: preview_sim.library_preview,
    wave_200_delta: preview_sim.wave_200_metrics.deltas,
    adopt_recommended: false,
    adopt_note_zh: '候選僅存於 g3-d3-repair-30；未寫入 batch-drafts；待確認後另開 adopt 流程',
  };

  if (write) {
    fs.mkdirSync(G3_D3_REPAIR_DIR, { recursive: true });
    write_json_atomic(FILE_G3_D3_LINEAGE_200, {
      schema_version: 1,
      generated_at: agent_doc.generated_at,
      counts: lineage.counts,
      tracks: lineage.tracks,
      summary_zh: lineage.summary_zh,
    });
    write_json_atomic(FILE_G3_D3_CATALOG_SOURCE_OVERLAY, overlay);
    write_json_atomic(FILE_G3_D3_SAMPLE_30, sample);
    write_json_atomic(FILE_G3_D3_AGENT_DRAFTS_30, agent_doc);
    write_json_atomic(FILE_G3_D3_COMPARISON, comparison);
    write_json_atomic(FILE_G3_D3_PREVIEW_SIMULATION, preview_sim);
    write_json_atomic(
      FILE_G3_D3_INPUT_30,
      export_payloads_30(sample_ids)
    );
    write_json_atomic(FILE_G3_D3_OFFLINE_SUMMARY, summary);
  }

  return {
    summary: summary,
    lineage: lineage,
    sample: sample,
    comparison: comparison,
    preview_sim: preview_sim,
  };
}
