/**
 * 情緒候選／staged inference 結構常數（Phase 0 規格）
 */

export const EMOTION_CANDIDATE_SCHEMA_VERSION = 1;
export const EMOTION_STAGED_SCHEMA_VERSION = 1;

/** Agent／AI 允許的 confidence（不得 confirmed） */
export const EMOTION_AI_CONFIDENCE_VALUES = ['inferred', 'unknown'];

export const EMOTION_REVIEW_PENDING = 'pending';
export const EMOTION_REVIEW_ACCEPTED = 'accepted';
export const EMOTION_REVIEW_MODIFIED = 'modified';
export const EMOTION_REVIEW_REJECTED = 'rejected';

export const EMOTION_REVIEW_STATUS_VALUES = [
  EMOTION_REVIEW_PENDING,
  EMOTION_REVIEW_ACCEPTED,
  EMOTION_REVIEW_MODIFIED,
  EMOTION_REVIEW_REJECTED,
];

/** 證據軸名稱 */
export const EVIDENCE_AXIS_SONIC = 'sonic';
export const EVIDENCE_AXIS_LYRICAL = 'lyrical';
export const EVIDENCE_AXIS_RHYTHMIC = 'rhythmic';

export const EVIDENCE_AXIS_NAMES = [
  EVIDENCE_AXIS_SONIC,
  EVIDENCE_AXIS_LYRICAL,
  EVIDENCE_AXIS_RHYTHMIC,
];

/**
 * evidence_axes.*.basis 允許值（Phase 0）
 * weak_* 僅弱線索；verified 類須對應旗標為 true
 */
export const EVIDENCE_BASIS_VALUES = [
  'weak_metadata_title',
  'weak_metadata_artists',
  'weak_metadata_album',
  'weak_genre_reference',
  'identity.duration_ms_fact_only',
  'direct_audio_feature',
  'lyric_text_verified',
  'human_listen_review',
  'agent_inference_declared',
];

/** 弱線索 basis（不可單獨支撐情緒標籤） */
export const WEAK_EVIDENCE_BASIS = new Set([
  'weak_metadata_title',
  'weak_metadata_artists',
  'weak_metadata_album',
  'weak_genre_reference',
  'identity.duration_ms_fact_only',
]);

/** 可支撐「非 unknown」標籤的強證據 basis */
export const STRONG_EVIDENCE_BASIS = new Set([
  'direct_audio_feature',
  'lyric_text_verified',
  'human_listen_review',
]);
