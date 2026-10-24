/**
 * G3-E.1 infer 產物：Cursor Agent 本工作階段逐首填寫（非 regex 規則腳本）
 * 由 g3_e1_infer.js 寫入 staged-inferences/；缺此檔則 infer 失敗
 */
import {
  G3_E1_AGENT_SOURCE,
  G3_E1_AGENT_METHOD,
  G3_E1_PROVENANCE_DECLARED,
} from './paths_e1.js';

function row(track_id, title, fields) {
  return Object.assign(
    {
      track_id: track_id,
      title: title,
      source: G3_E1_AGENT_SOURCE,
      method: G3_E1_AGENT_METHOD,
      inference_source: G3_E1_AGENT_SOURCE,
      provenance: {
        status: G3_E1_PROVENANCE_DECLARED,
        provenance_unverified: true,
        model_api_session_id: null,
        model_name: null,
        execution_method: 'cursor_ide_agent_chat_turn',
        note_zh:
          '本列由 E.1 工作流 infer 階段之 Agent 回覆寫入；無 Spotify/MB API；無可驗證 session ID',
      },
      confidence: 'inferred',
      human_locked: false,
    },
    fields
  );
}

/**
 * 五首 Agent 推理（2026-10-22）
 */
export const G3_E1_AGENT_INFERENCES = [
  row('2ENeL62SA94IHbCokT5U2W', '友情歲月（電影《古惑仔之人在江湖》主題曲）', {
    confidence_tier: 'high',
    genre_profile: {
      primary_genre: 'rock',
      subgenres: ['pop_rock'],
      secondary_genres: ['pop'],
      confidence: 'inferred',
    },
    language: {
      value: '粵語',
      confidence: 'inferred',
      vocal_verification_status: 'unverified',
      evidence: '鄭伊健（Ekin Cheng）港樂系譜＋標題明示古惑仔粵語主題曲；Friends for Life 專輯脈絡',
    },
    contexts: [{ value: '懷舊', confidence: 'inferred' }],
    special_types: [{ value: '電影／電視原聲帶', confidence: 'inferred' }],
    version_uncertainty: false,
    reason_zh:
      '電影《古惑仔之人在江湖》粵語主題曲標題為直接證據；港樂流行搖滾優於 D.1 unknown fallback',
    evidence_used: ['identity.title', 'identity.artists', 'identity.album_name', 'sourced_evidence_facts'],
    unverified_fields: ['vocal_language'],
  }),
  row('0ZOgcAy8cOw7xSWp6IjSfC', 'Lettre à Maelle', {
    confidence_tier: 'medium',
    genre_profile: {
      primary_genre: 'soundtrack_instrumental',
      subgenres: ['game_score'],
      secondary_genres: [],
      confidence: 'inferred',
    },
    language: {
      value: '未確認',
      confidence: 'unknown',
      vocal_verification_status: 'unverified',
      evidence: '法文書信式曲名不推演唱語言；Lorien Testard 多為 Clair Obscur 遊戲 BGM',
    },
    contexts: [{ value: '放鬆', confidence: 'inferred' }],
    special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
    version_uncertainty: false,
    reason_zh:
      'Lorien Testard＋Lettre 敘事配樂命名；維持配樂但理由為遊戲脈絡而非僅 composer regex',
    evidence_used: ['identity.title', 'identity.artists'],
    unverified_fields: ['vocal_language', 'instrumental_vs_vocal'],
  }),
  row('680YpUhUvGBLMRQpbuxy1Q', 'Gestral Village - Alicia (Gestrals)', {
    confidence_tier: 'medium',
    genre_profile: {
      primary_genre: 'soundtrack_instrumental',
      subgenres: ['game_score'],
      secondary_genres: [],
      confidence: 'inferred',
    },
    language: {
      value: '未確認',
      confidence: 'unknown',
      vocal_verification_status: 'unverified',
      evidence: 'Gestral Village 區域名；是否含人聲未核實',
    },
    contexts: [],
    special_types: [{ value: '遊戲音樂', confidence: 'inferred' }],
    version_uncertainty: false,
    reason_zh:
      '曲名 Gestral Village／Gestrals 為 Clair Obscur 遊戲區域 BGM；D.1 僅 composer heuristic',
    evidence_used: ['identity.title', 'identity.artists'],
    unverified_fields: ['vocal_language', 'instrumental_vs_vocal'],
  }),
  row('6uIXIZmKdEswGUpHJeNSkk', 'Mutter', {
    confidence_tier: 'medium',
    genre_profile: {
      primary_genre: 'pop',
      subgenres: ['adult_contemporary'],
      secondary_genres: ['folk'],
      confidence: 'inferred',
    },
    language: {
      value: '其他',
      confidence: 'inferred',
      vocal_verification_status: 'unverified',
      evidence: 'Milva 義德系 Schlager／實驗流行 repertoire；德語曲名 Mutter',
    },
    contexts: [{ value: '懷舊', confidence: 'inferred' }],
    version_uncertainty: false,
    reason_zh:
      'Milva 以德義語流行與實驗曲目著稱；D.1 metadata fallback unknown 過保守',
    evidence_used: ['identity.title', 'identity.artists'],
    unverified_fields: ['vocal_language'],
  }),
  row('7rIovIsXE6kMn629b7kDig', 'I Will Survive', {
    confidence_tier: 'high',
    genre_profile: {
      primary_genre: 'pop',
      subgenres: ['dance_pop'],
      secondary_genres: ['rnb_soul'],
      confidence: 'inferred',
    },
    language: {
      value: '英文',
      confidence: 'inferred',
      vocal_verification_status: 'unverified',
      evidence: 'Gloria Gaynor 1978 迪斯科／流行經典人聲曲系譜',
    },
    contexts: [{ value: '懷舊', confidence: 'inferred' }],
    special_types: [],
    version_uncertainty: false,
    reason_zh:
      'Gloria Gaynor 代表曲 I Will Survive；D.1 規則未命中而 unknown，歌手 discography 足夠',
    evidence_used: ['identity.artists', 'identity.title'],
    unverified_fields: ['vocal_language'],
  }),
];
