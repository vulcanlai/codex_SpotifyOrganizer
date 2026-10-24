/**
 * G3-B Cursor AI 批次輸入（結構化 JSON + Markdown）
 */
import { GENRE_PRIMARY_UNKNOWN, MAIN_GENRES } from '../genre_taxonomy.js';
import { LANGUAGE_VALUES } from '../dimensions.js';

/**
 * @param {object[]} track_payloads
 * @param {object} meta
 */
export function build_g3b_ai_input_json(track_payloads, meta) {
  return {
    schema_version: 1,
    sample_id: meta.sample_id,
    exported_at: meta.exported_at,
    purpose: 'g3_b_ai_classification_import',
    rules_ref: 'backup/classification/g3-b-trial-30/cursor-g3b-input.md',
    track_count: track_payloads.length,
    tracks: track_payloads,
  };
}

/**
 * @param {object[]} payloads
 * @param {object} meta
 */
export function build_g3b_ai_input_md(payloads, meta) {
  let md = '# G3-B 自動分類試驗（Cursor AI 輸入）\n\n';
  md += '請依 **G3-A 證據** 產生 `backup/classification/g3-b-trial-30/ai-classification-draft.json`。\n\n';
  md += '## 硬性規則\n\n';
  md += '1. **不得**呼叫 Spotify / MusicBrainz / 付費 API。\n';
  md += '2. **不得**捏造 Track ID、歌名、藝人。\n';
  md += '3. MB tags **不得**直接當已確認主曲風；僅可作推論並標 `inferred`。\n';
  md += '4. **演唱語言**（必讀）：須區分 **歌名文字**、**藝人姓名文字**、**此 Spotify 錄音版演唱語言**、**原曲語言**。**不得**僅因拉丁字歌名判英文演唱；**不得**依藝人國籍判語言。MusicBrainz 錄音 matched **≠** 已取得演唱語言。\n';
  md += '5. 語言輸出必含 `vocal_verification_status`：`unverified`（預設）或 `human_known_fixture`；**禁止**寫成 MB 查證語言。\n';
  md += '6. `unverified_cross_script` 曲目：藝人未核實，confidence 上限 `medium`。\n';
  md += '7. `human_confirmation.locked=true` 曲目：**不要**輸出覆蓋性分類（可省略或複製現有人工結果並標 `human_locked`）。\n';
  md += '8. 輸出 confidence 僅能 `inferred` / `unknown`；**禁止** `confirmed`（confirmed 僅人工流程）。\n';
  md += '9. 主曲風 12 類 + 子曲風 40 類（見 genre_taxonomy）。\n';
  md += '10. 蘇慧倫〈Lemon Tree〉`05B8gt3dCepBPmGe7SPAUo`：此錄音版演唱語言應為**國語**（G1 陷阱案例）；若僅能推測須標 `unverified` 並說明非歌名推論。\n\n';
  md += '## 主曲風代碼\n\n';
  for (let i = 0; i < MAIN_GENRES.length; i += 1) {
    md += '- `' + MAIN_GENRES[i].code + '`：' + MAIN_GENRES[i].label_zh + '\n';
  }
  md += '\n## 語言\n\n';
  md += LANGUAGE_VALUES.join('、') + '\n\n';
  md += '## 樣本\n\n';
  md += '- sample_id：' + meta.sample_id + '\n';
  md += '- 匯出：' + meta.exported_at + '\n';
  md += '- 曲目：' + payloads.length + '\n\n';

  for (let t = 0; t < payloads.length; t += 1) {
    const p = payloads[t];
    md += '### ' + (t + 1) + '. ' + p.identity.title + '\n\n';
    md += '- **Spotify ID**：`' + p.track_id + '`\n';
    md += '- **藝人**：' + (p.identity.artists || []).join('、') + '\n';
    md += '- **人工鎖定**：' + (p.human_confirmation.locked ? '是' : '否') + '\n';
    md += '- **規則草稿 kind**：' + p.rule_draft.classification_kind + '\n';
    md += '- **待 AI**：' + (p.ai_pending ? '是' : '否') + '\n';
    md += '- **佇列狀態**：' + (p.queue_state || '—') + '\n\n';
    md += '#### 證據摘要（JSON）\n\n';
    md += '```json\n';
    md += JSON.stringify(p.evidence_compact, null, 2);
    md += '\n```\n\n';
  }
  return md;
}

/**
 * @param {object} evidence_doc
 * @param {object} rule_draft
 */
export function compact_evidence_for_ai(evidence_doc, rule_draft) {
  const v = evidence_doc.verification_status || {};
  return {
    priority_resolution: evidence_doc.priority_resolution,
    human_confirmation: evidence_doc.human_confirmation,
    verification: {
      g1: v.g1,
      g2: v.g2,
      g2_1_offline: v.g2_1_offline,
    },
    facts_fields: (evidence_doc.facts || []).map(function (f) {
      return f.field;
    }),
    has_ai_candidate: (evidence_doc.classification_candidates || []).length > 0,
    rule_draft_kind: rule_draft.classification_kind,
    uncertainty: rule_draft.uncertainty,
    vocal_language_note:
      'MB 不提供演唱語言；勿把錄音 matched 當語言證據',
  };
}

export { GENRE_PRIMARY_UNKNOWN };
