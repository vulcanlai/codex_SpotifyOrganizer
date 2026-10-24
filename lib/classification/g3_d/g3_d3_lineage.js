/**
 * G3-D.1 200 首推理來源追溯
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { classify_g3_d1_from_evidence } from './g3_d1_evidence_classify.js';
import { G3_D1_BATCH_DRAFTS_DIR, G3_D1_BATCH_INPUTS_DIR } from './paths_d1.js';

function load_imported() {
  /** @type {object[]} */
  const rows = [];
  const files = fs.readdirSync(G3_D1_BATCH_DRAFTS_DIR).filter(function (f) {
    return f.endsWith('-imported.json');
  });
  files.sort();
  for (let i = 0; i < files.length; i += 1) {
    const doc = JSON.parse(
      fs.readFileSync(path.join(G3_D1_BATCH_DRAFTS_DIR, files[i]), 'utf8')
    );
    rows.push.apply(rows, doc.tracks || []);
  }
  return rows;
}

function load_payload_map() {
  /** @type {Record<string, object>} */
  const map = {};
  const files = fs.readdirSync(G3_D1_BATCH_INPUTS_DIR).filter(function (f) {
    return f.endsWith('-input.json');
  });
  for (let i = 0; i < files.length; i += 1) {
    const doc = JSON.parse(
      fs.readFileSync(path.join(G3_D1_BATCH_INPUTS_DIR, files[i]), 'utf8')
    );
    const payloads = doc.evidence_payloads || [];
    for (let p = 0; p < payloads.length; p += 1) {
      map[payloads[p].track_id] = payloads[p];
    }
  }
  return map;
}

function stable_json_hash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function infer_production_kind(row, payload, regen) {
  if (row.human_locked) {
    return 'human_locked_skip';
  }
  const reason = row.reason_zh || '';
  if (reason === 'metadata／候選不足；保留 unknown 與未確認') {
    return 'rule_fallback_unknown';
  }
  if (
    regen &&
    regen.genre_profile.primary_genre === row.genre_profile.primary_genre &&
    regen.reason_zh === row.reason_zh
  ) {
    if (reason.indexOf('配樂') >= 0 || reason.indexOf('遊戲') >= 0) {
      return 'rule_heuristic_soundtrack_branch';
    }
    if (reason.indexOf('歌手') >= 0 || reason.indexOf('系譜') >= 0) {
      return 'rule_heuristic_artist_discography_branch';
    }
    if (reason.indexOf('參考既有 AI 候選') >= 0) {
      return 'rule_candidate_hint_branch';
    }
    return 'rule_heuristic_g3_d1_evidence_classify';
  }
  return 'rule_heuristic_mismatch_or_manual_edit';
}

/**
 * @returns {{ tracks: object[], counts: object }}
 */
export function build_d1_lineage_200() {
  const rows = load_imported();
  const payloads = load_payload_map();
  const counts = {
    cursor_agent_actual_ai: 0,
    rule_heuristic_g3_d1_evidence_classify: 0,
    rule_heuristic_soundtrack_branch: 0,
    rule_heuristic_artist_discography_branch: 0,
    rule_candidate_hint_branch: 0,
    rule_fallback_unknown: 0,
    reused_legacy_ai: 0,
    other: 0,
  };

  /** @type {object[]} */
  const tracks = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const payload = payloads[row.track_id];
    let regen = null;
    if (payload) {
      regen = classify_g3_d1_from_evidence(payload);
    }
    const kind = payload
      ? infer_production_kind(row, payload, regen)
      : 'missing_payload';
    if (counts[kind] != null) {
      counts[kind] += 1;
    } else {
      counts.other += 1;
    }
    tracks.push({
      track_id: row.track_id,
      title: row.title,
      d1_catalog_label: 'g3_d1_batch',
      inference_source_kind: kind,
      inference_source_zh:
        kind === 'cursor_agent_actual_ai'
          ? 'Cursor Agent 逐首推理'
          : kind.indexOf('rule_') === 0
            ? 'g3:d1-generate-drafts 規則層（非 Agent 逐首）'
            : kind,
      d1_primary: row.genre_profile.primary_genre,
      d1_confidence_tier: row.confidence_tier,
      d1_reason_zh: row.reason_zh,
      regen_matches_d1:
        regen &&
        regen.genre_profile.primary_genre === row.genre_profile.primary_genre &&
        regen.reason_zh === row.reason_zh,
      pipeline_zh:
        'g3-d1-generate-cursor-drafts.js → g3_d1_evidence_classify.js',
    });
  }

  return {
    tracks: tracks,
    counts: counts,
    summary_zh: [
      'D.1 cursor-drafts 由 generate-drafts 規則再生，與匯入列一致時標 rule_*',
      'catalog 來源 g3_d1_batch 表示「已匯入 G3-B 管線」，不等於 Cursor 逐首 AI',
    ],
  };
}

/**
 * overlay 修正 catalog 顯示用 inference 來源（不寫回 batch-drafts）
 */
export function build_catalog_source_overlay(lineage_doc) {
  const doc = lineage_doc || build_d1_lineage_200();
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    note_zh: '統一檢視可選讀取；不覆寫 g3_d1_batch 匯入檔',
    by_track_id: doc.tracks.reduce(function (acc, t) {
      acc[t.track_id] = {
        catalog_import_source: 'g3_d1_batch',
        effective_inference_source: t.inference_source_kind,
        display_label_zh:
          t.inference_source_kind === 'cursor_agent_actual_ai'
            ? 'G3-D.1 Cursor AI'
            : 'G3-D.1 規則推理（evidence_classify）',
      };
      return acc;
    }, {}),
    counts: doc.counts,
  };
}
