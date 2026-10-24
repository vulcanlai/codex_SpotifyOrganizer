/**
 * 分類維度常數（可擴充）
 */

export const DIMENSION_DECADE = 'decade';
export const DIMENSION_LANGUAGE = 'language';
export const DIMENSION_GENRE = 'genre';
export const DIMENSION_CONTEXT = 'context';
export const DIMENSION_SPECIAL = 'special_type';

export const DECADE_VALUES = [
  '1970s',
  '1980s',
  '1990s',
  '2000s',
  '2010s',
  '2020s',
  '其他年代',
  '年代未知',
];

export const LANGUAGE_VALUES = [
  '國語',
  '台語',
  '粵語',
  '英文',
  '日文',
  '韓文',
  '其他',
  '未確認',
];

export const GENRE_VALUES = [
  '流行',
  '搖滾',
  '電子',
  '舞曲',
  '嘻哈',
  '爵士',
  '古典',
  '民謠',
  '其他',
  '未確認',
];

export const CONTEXT_VALUES = [
  '運動',
  '開車',
  '放鬆',
  '睡前',
  '工作',
  '派對',
  '懷舊',
  '其他',
];

export const SPECIAL_TYPE_VALUES = [
  '電影／電視原聲帶',
  '動漫',
  '遊戲音樂',
  '純音樂',
  '現場演唱',
  '完整專輯收藏',
  '其他',
  '未確認',
];

/** AI 候選允許的 confidence（不得 confirmed） */
export const AI_CANDIDATE_CONFIDENCE_VALUES = ['inferred', 'unknown'];

export const CONFIDENCE_CONFIRMED = 'confirmed';
export const CONFIDENCE_INFERRED = 'inferred';
export const CONFIDENCE_UNKNOWN = 'unknown';
