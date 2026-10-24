/**
 * 演唱語言 vs 歌名／藝人文字（G3-B.2）
 */
import { G1_MUST_INCLUDE_LEMON_TREE } from '../../enrichment/external/g1_sample.js';

export const VOCAL_VERIFICATION_UNVERIFIED = 'unverified';
export const VOCAL_VERIFICATION_HUMAN_KNOWN = 'human_known_fixture';
export const VOCAL_VERIFICATION_LYRICS = 'lyrics_source';

const LATIN_TITLE = /^[\x00-\x7F\s\d\p{P}]+$/u;

/**
 * @param {string} text
 */
export function script_hint_for_text(text) {
  if (!text || typeof text !== 'string') {
    return 'unknown';
  }
  if (/[\u4e00-\u9fff]/.test(text)) {
    return 'cjk';
  }
  if (/[\u3040-\u30ff]/.test(text)) {
    return 'kana';
  }
  if (/[\uac00-\ud7af]/.test(text)) {
    return 'hangul';
  }
  if (LATIN_TITLE.test(text)) {
    return 'latin';
  }
  return 'mixed';
}

/**
 * MB 匹配錄音是否提供演唱語言（目前 G1/G2 不提供）
 * @param {object} evidence_doc
 */
export function mb_provides_vocal_language(evidence_doc) {
  const facts = evidence_doc.facts || [];
  for (let i = 0; i < facts.length; i += 1) {
    if (facts[i].field === 'vocal_language' || facts[i].field === 'lyrics_language') {
      return true;
    }
  }
  return false;
}

/**
 * @param {object} evidence_doc
 * @param {object} ai_language_row language 物件
 */
export function detect_title_only_language_risk(evidence_doc, ai_language_row) {
  const title = evidence_doc.identity && evidence_doc.identity.title;
  const lang_val = ai_language_row && ai_language_row.value;
  const evidence_text =
    (ai_language_row && (ai_language_row.evidence || '')) +
    (ai_language_row && ai_language_row.method ? ai_language_row.method : '');

  if (!title || !lang_val || lang_val === '未確認') {
    return { risky: false, reasons: [] };
  }

  const title_script = script_hint_for_text(title);
  const reasons = [];

  if (title_script === 'latin' && (lang_val === '英文' || lang_val === '其他')) {
    if (
      !mb_provides_vocal_language(evidence_doc) &&
      (!evidence_text ||
        /歌名|英文歌名|翻唱|專輯脈絡|公開.*英|metadata/i.test(evidence_text))
    ) {
      reasons.push('演唱語言推論可能僅依拉丁字歌名或翻唱敘述，非歌詞或核實來源');
    }
  }

  if (/國籍|artist.*country|因.*藝人/i.test(evidence_text)) {
    reasons.push('證據文字疑似依藝人國籍推語言');
  }

  return {
    risky: reasons.length > 0,
    reasons: reasons,
    title_script: title_script,
  };
}

/**
 * 專案回歸 fixture（非 MB、非使用者偽裝成 MB）
 */
export const KNOWN_VOCAL_LANGUAGE_FIXTURES = {
  [G1_MUST_INCLUDE_LEMON_TREE]: {
    track_id: G1_MUST_INCLUDE_LEMON_TREE,
    title: 'Lemon Tree',
    vocal_language: '國語',
    source_type: 'project_regression_fixture',
    note: 'G1 語言陷阱案例：蘇慧倫此 Spotify 錄音以國語演唱為主；MusicBrainz 僅確認錄音身分，不提供演唱語言。',
    does_not_claim_mb_verification: true,
  },
};

/**
 * @param {string} track_id
 */
export function get_known_vocal_language_fixture(track_id) {
  return KNOWN_VOCAL_LANGUAGE_FIXTURES[track_id] || null;
}

/**
 * 正規化 AI 語言欄位（匯入前／匯入後皆應帶 unverified 除非 human fixture）
 * @param {object} language_row
 * @param {object} evidence_doc
 */
export function normalize_vocal_language_fields(language_row, evidence_doc) {
  const row = language_row ? Object.assign({}, language_row) : { value: '未確認' };
  const fixture = get_known_vocal_language_fixture(evidence_doc.track_id);

  if (fixture) {
    return {
      value: fixture.vocal_language,
      confidence: 'inferred',
      method: fixture.source_type,
      vocal_verification_status: VOCAL_VERIFICATION_HUMAN_KNOWN,
      evidence: fixture.note,
      does_not_claim_mb_verification: true,
    };
  }

  if (!row.vocal_verification_status) {
    row.vocal_verification_status = VOCAL_VERIFICATION_UNVERIFIED;
  }
  if (row.confidence === 'confirmed') {
    row.confidence = 'inferred';
  }
  if (!mb_provides_vocal_language(evidence_doc) && row.value !== '未確認') {
    row.vocal_verification_status = VOCAL_VERIFICATION_UNVERIFIED;
  }
  return row;
}
