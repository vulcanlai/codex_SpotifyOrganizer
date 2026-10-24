/**
 * 診斷 ai_pending 與 unknown 的關係（G3-B.1）
 */
import fs from 'node:fs';
import { FILE_G3_B_RULE_DRAFT, FILE_G3_B_AI_PENDING } from './paths.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';

function read_json(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function explain_ai_pending(track_row, evidence_doc) {
  if (track_row.ai_pending) {
    const reasons = [];
    const pr = evidence_doc.priority_resolution || {};
    if (pr.effective_for_classification === 'ai_suggested') {
      reasons.push('formal/索引為 ai_suggested');
    }
    if ((evidence_doc.classification_candidates || []).length > 0) {
      reasons.push('存在未審核 AI 候選');
    }
    if (!evidence_doc.identity.enrichment_cache_complete) {
      reasons.push('enrichment 快取不完整');
    }
    return { included: true, reasons: reasons };
  }

  const id = track_row.track_id;
  const enrichment = evidence_doc.identity.enrichment_cache_complete;
  const ai_c = (evidence_doc.classification_candidates || []).length;
  const eff = (evidence_doc.priority_resolution || {}).effective_for_classification;

  let exclude_reason = 'enrichment 完整且無 AI 候選、非 ai_suggested';
  if (eff === 'external_facts_g2_1') {
    exclude_reason =
      '已有 G2.1 外部錄音優先，但規則未映射主曲風；現行 ai_pending 門檻未包含此類';
  }
  if (eff === 'unknown' && track_row.classification_kind === 'unknown') {
    exclude_reason =
      '僅索引 metadata 不足且無 v2 候選；ai_pending 需 ai_suggested／候選／enrichment 缺漏';
  }
  if (track_row.classification_kind === 'inference' && !track_row.ai_pending) {
    exclude_reason = '規則已由 MB 標籤推得 inference，無需排入 AI 佇列';
  }

  return {
    included: false,
    exclude_reason: exclude_reason,
    enrichment_cache_complete: enrichment,
    ai_candidate_count: ai_c,
    effective_for_classification: eff,
    classification_kind: track_row.classification_kind,
  };
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function build_ai_pending_diagnostic(opts) {
  const options = opts || {};
  const rule_doc = read_json(FILE_G3_B_RULE_DRAFT);
  const pending_doc = read_json(FILE_G3_B_AI_PENDING);
  const ev_index = read_json(file_g3_evidence_index());

  const unknown_rows = rule_doc.tracks.filter(function (t) {
    return t.classification_kind === 'unknown';
  });
  const pending_ids = {};
  (pending_doc.pending || []).forEach(function (p) {
    pending_ids[p.track_id] = true;
  });

  const unknown_not_pending = unknown_rows.filter(function (t) {
    return !t.ai_pending;
  });

  const details = rule_doc.tracks.map(function (row) {
    const ev = ev_index.tracks[row.track_id];
    return {
      track_id: row.track_id,
      classification_kind: row.classification_kind,
      ai_pending: row.ai_pending,
      explain: explain_ai_pending(row, ev || { identity: {}, priority_resolution: {} }),
    };
  });

  const doc = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    summary_zh: [
      'unknown 共 ' +
        unknown_rows.length +
        ' 首，其中 ai_pending=true 為 ' +
        unknown_rows.filter(function (t) {
          return t.ai_pending;
        }).length +
        ' 首',
      'ai_pending 共 ' +
        rule_doc.tracks.filter(function (t) {
          return t.ai_pending;
        }).length +
        ' 首（含非 unknown 的 evidence_direct/inference）',
      'unknown 但未進 AI 佇列：' + unknown_not_pending.length + ' 首',
    ],
    ai_pending_gate_zh:
      'should_ai_pending = 非 human_locked 且（effective=ai_suggested 或 有 AI 候選 或 enrichment 不完整）',
    unknown_not_pending: unknown_not_pending.map(function (t) {
      const ev = ev_index.tracks[t.track_id];
      return {
        track_id: t.track_id,
        title: ev && ev.identity ? ev.identity.title : null,
        explain: explain_ai_pending(t, ev || {}),
      };
    }),
    possible_gap_zh:
      '若希望「僅 unknown 主曲風」也送 AI，需另開規則；現行設計刻意排除 enrichment 完整且無候選的 13 首，避免全庫過量送審。',
    tracks: details,
  };

  if (options.write !== false) {
    const out_path = FILE_G3_B_RULE_DRAFT.replace(
      'rule-classification-draft.json',
      'ai-pending-diagnostic.json'
    );
    fs.writeFileSync(out_path, JSON.stringify(doc, null, 2), 'utf8');
  }
  return doc;
}
