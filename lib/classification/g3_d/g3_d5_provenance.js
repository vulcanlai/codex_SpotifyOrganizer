/**
 * G3-D.5 Agent 推理來源稽核（不修改草稿）
 */
import fs from 'node:fs';
import path from 'node:path';
import { G3_D3_AGENT_REPAIR_TRACKS } from './g3_d3_agent_repair_drafts.js';
import { FILE_G3_D3_AGENT_DRAFTS_30 } from './paths_d3.js';
import {
  G3_D4_AGENT_DRAFTS_DIR,
  FILE_G3_D4_MERGED_CANDIDATE_200,
} from './paths_d4.js';
import { G3_D5_BUILDER_SCRIPT_REL } from './paths_d5.js';
import { reconcile_d1_d3_d4 } from './g3_d4_reconcile.js';

const D1_TEMPLATE_REASONS = [
  'metadata／候選不足；保留 unknown 與未確認',
  '專輯或作曲者脈絡指向配樂／改編 instrumental；非 Spotify API',
  '作曲／專輯脈絡指向遊戲或影視配樂；器樂為主',
  '歌手公開作品系譜以英語流行为主；非僅拉丁字歌名',
];

function load_d3_ids() {
  return G3_D3_AGENT_REPAIR_TRACKS.map(function (t) {
    return t.track_id;
  });
}

function load_d4_01_03_ids() {
  const batches = ['g3d4-batch-01', 'g3d4-batch-02', 'g3d4-batch-03'];
  const ids = [];
  for (let i = 0; i < batches.length; i += 1) {
    const p = path.join(G3_D4_AGENT_DRAFTS_DIR, batches[i] + '.json');
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (let t = 0; t < doc.tracks.length; t += 1) {
      ids.push(doc.tracks[t].track_id);
    }
  }
  return ids;
}

function load_builder_script_ids(project_root) {
  const p = path.join(project_root, G3_D5_BUILDER_SCRIPT_REL.replace(/\//g, path.sep));
  if (!fs.existsSync(p)) {
    return { ids: [], script_found: false };
  }
  const text = fs.readFileSync(p, 'utf8');
  const re = /'([0-9A-Za-z]{22})':/g;
  const ids = [];
  const seen = {};
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!seen[m[1]]) {
      seen[m[1]] = true;
      ids.push(m[1]);
    }
  }
  return { ids: ids, script_found: true, script_path: G3_D5_BUILDER_SCRIPT_REL };
}

function find_batch_file(track_id, reconcile) {
  for (let b = 0; b < reconcile.batches.length; b += 1) {
    const batch = reconcile.batches[b];
    if (batch.track_ids.indexOf(track_id) >= 0) {
      return batch.batch_id;
    }
  }
  return null;
}

/**
 * @param {string} [project_root]
 */
export function audit_agent_provenance_200(project_root) {
  const root = project_root || process.cwd();
  const merged = JSON.parse(fs.readFileSync(FILE_G3_D4_MERGED_CANDIDATE_200, 'utf8'));
  const tracks = merged.tracks || [];
  const reconcile = reconcile_d1_d3_d4();
  const d3_set = {};
  load_d3_ids().forEach(function (id) {
    d3_set[id] = true;
  });
  const d4_0103_set = {};
  load_d4_01_03_ids().forEach(function (id) {
    d4_0103_set[id] = true;
  });
  const builder = load_builder_script_ids(root);
  const builder_set = {};
  builder.ids.forEach(function (id) {
    builder_set[id] = true;
  });

  const reason_index = {};
  const duplicate_reason_groups = [];

  /** @type {object[]} */
  const per_track = [];
  let source_declaration_only = 0;
  let provenance_unverified = 0;
  let attested_module = 0;
  let has_individual_reason = 0;

  for (let i = 0; i < tracks.length; i += 1) {
    const row = tracks[i];
    const id = row.track_id;
    const rz = row.reason_zh || '';
    let storage_kind = 'merged_candidate_json';
    let batch_id = null;
    let provenance_status = 'provenance_unverified';
    let agent_session_proven = false;
    let notes_zh = [];

    if (d3_set[id]) {
      storage_kind = 'lib/g3_d3_agent_repair_drafts.js + cursor-agent-drafts-30.json';
      provenance_status = 'attested_module_no_session_log';
      agent_session_proven = false;
      attested_module += 1;
      notes_zh.push('D.3 模組內 Agent 填寫聲明；無逐首 session 紀錄');
    } else if (d4_0103_set[id]) {
      storage_kind = 'lib/g3_d4_write_batches_01_03.js + g3d4-batch-0X.json';
      provenance_status = 'attested_module_no_session_log';
      attested_module += 1;
      batch_id = find_batch_file(id, reconcile);
      notes_zh.push('D.4 批次 01–03 模組填寫；無 session log');
    } else if (builder_set[id]) {
      storage_kind = 'build_batches_04_17.mjs → g3d4-batch-XX.json';
      provenance_status = 'provenance_unverified';
      provenance_unverified += 1;
      batch_id = find_batch_file(id, reconcile);
      notes_zh.push(
        '內容可追溯至 builder 腳本 BY_ID 映射；無法證實獨立 Agent 工作階段逐首推理'
      );
    } else {
      provenance_unverified += 1;
      notes_zh.push('無法對應 D.3/D.4 已知產出鏈');
    }

    if (row.source && String(row.source).indexOf('cursor_agent') >= 0 && !agent_session_proven) {
      source_declaration_only += 1;
    }

    const template_hit = D1_TEMPLATE_REASONS.indexOf(rz) >= 0;
    const rule_like =
      template_hit ||
      (rz.indexOf('非僅拉丁字歌名') >= 0 && rz.length < 35) ||
      (rz.indexOf('非 Spotify API') >= 0 && rz.indexOf('；') < 0);

    if (rz.length >= 20 && !template_hit) {
      has_individual_reason += 1;
    }

    if (rz) {
      if (!reason_index[rz]) {
        reason_index[rz] = [];
      }
      reason_index[rz].push(id);
    }

    per_track.push({
      track_id: id,
      title: row.title,
      declared_source: row.source,
      method: row.method || null,
      inference_source: row.inference_source || null,
      storage_kind: storage_kind,
      batch_id: batch_id,
      provenance_status: provenance_status,
      agent_session_proven: agent_session_proven,
      source_declaration_only: !agent_session_proven,
      rule_or_template_like: rule_like,
      reason_length: rz.length,
      evidence_used_count: (row.evidence_used || []).length,
    });
  }

  const reasons = Object.keys(reason_index);
  for (let r = 0; r < reasons.length; r += 1) {
    if (reason_index[reasons[r]].length > 1 && reasons[r].length > 15) {
      duplicate_reason_groups.push({
        reason_zh: reasons[r],
        track_ids: reason_index[reasons[r]],
        count: reason_index[reasons[r]].length,
      });
    }
  }

  return {
    schema_version: 1,
    track_count: tracks.length,
    d3_module_path: 'lib/classification/g3_d/g3_d3_agent_repair_drafts.js',
    d3_export_json: FILE_G3_D3_AGENT_DRAFTS_30,
    d4_batches_01_03_module: 'lib/classification/g3_d/g3_d4_write_batches_01_03.js',
    d4_batches_04_17_builder: builder.script_found ? G3_D5_BUILDER_SCRIPT_REL : null,
    summary: {
      attested_module_no_session_log: attested_module,
      provenance_unverified: provenance_unverified,
      source_declaration_only: source_declaration_only,
      individual_reason_ge_20_chars: has_individual_reason,
      duplicate_reason_groups: duplicate_reason_groups.length,
      rule_or_template_like_count: per_track.filter(function (x) {
        return x.rule_or_template_like;
      }).length,
    },
    duplicate_reason_groups: duplicate_reason_groups,
    tracks: per_track,
    conclusion_zh:
      '200 首皆具 JSON/模組內逐首欄位與批次追溯；無 Agent session log。140 首（batch 04–17）標記 provenance_unverified；60 首為 attested_module_no_session_log。來源標籤 alone 不足以視為已證實 Agent 推理。',
  };
}
