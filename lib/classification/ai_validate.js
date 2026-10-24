/**
 * AI 候選分類驗證
 */
import {
  LANGUAGE_VALUES,
  GENRE_VALUES,
  CONTEXT_VALUES,
  SPECIAL_TYPE_VALUES,
  AI_CANDIDATE_CONFIDENCE_VALUES,
  CONFIDENCE_CONFIRMED,
} from './dimensions.js';
import {
  AI_CANDIDATES_SCHEMA_VERSION,
  AI_CANDIDATES_V2_SCHEMA_VERSION,
} from './paths.js';
import {
  normalize_genre_profile,
  validate_genre_profile,
  genre_profile_from_ai_candidate,
} from './genre_profile.js';
import {
  is_main_genre_code,
  SUBGENRES_BY_CODE,
  GENRE_PRIMARY_UNKNOWN,
} from './genre_taxonomy.js';

export class AiCandidatesValidationError extends Error {
  /**
   * @param {string[]} errors
   */
  constructor(errors) {
    super(errors.join('；'));
    this.name = 'AiCandidatesValidationError';
    this.errors = errors;
  }
}

function validate_ai_genre_tag(item, label) {
  const errors = [];
  if (!item || typeof item !== 'object') {
    errors.push(`${label} 必須為物件`);
    return errors;
  }
  if (item.confidence === CONFIDENCE_CONFIRMED) {
    errors.push(`${label} 不得使用 confidence=confirmed`);
  }
  if (AI_CANDIDATE_CONFIDENCE_VALUES.indexOf(item.confidence) < 0) {
    errors.push(`${label}.confidence 非法`);
  }
  if (typeof item.evidence !== 'string' || !item.evidence.trim()) {
    errors.push(`${label}.evidence 必填`);
  }
  if (typeof item.method !== 'string' || !item.method.trim()) {
    errors.push(`${label}.method 必填`);
  }
  if (typeof item.source !== 'string' || !item.source.trim()) {
    errors.push(`${label}.source 必填`);
  }
  return errors;
}

const VALUE_SETS = {
  language: LANGUAGE_VALUES,
  genre: GENRE_VALUES,
  context: CONTEXT_VALUES,
  special_type: SPECIAL_TYPE_VALUES,
};

/**
 * @param {unknown} item
 * @param {string} dimension
 * @param {string} label
 */
function validate_tag_item(item, dimension, label) {
  const errors = [];
  if (!item || typeof item !== 'object') {
    errors.push(`${label} 必須為物件`);
    return errors;
  }
  const allowed = VALUE_SETS[dimension];
  if (!allowed || allowed.indexOf(item.value) < 0) {
    errors.push(`${label}.value 非法：${item && item.value}`);
  }
  if (item.confidence === CONFIDENCE_CONFIRMED) {
    errors.push(`${label} 不得使用 confidence=confirmed`);
  }
  if (AI_CANDIDATE_CONFIDENCE_VALUES.indexOf(item.confidence) < 0) {
    errors.push(`${label}.confidence 非法`);
  }
  if (typeof item.evidence !== 'string' || !item.evidence.trim()) {
    errors.push(`${label}.evidence 必填`);
  }
  if (typeof item.method !== 'string' || !item.method.trim()) {
    errors.push(`${label}.method 必填`);
  }
  if (typeof item.source !== 'string' || !item.source.trim()) {
    errors.push(`${label}.source 必填`);
  }
  return errors;
}

/**
 * @param {object} candidate
 * @param {number} index
 */
function validate_one_candidate(candidate, index) {
  const errors = [];
  const prefix = `candidates[${index}]`;
  if (!candidate.spotify_id || typeof candidate.spotify_id !== 'string') {
    errors.push(`${prefix} 缺少 spotify_id`);
    return errors;
  }

  if (candidate.language == null) {
    errors.push(`${prefix} 缺少 language`);
  } else {
    errors.push.apply(
      errors,
      validate_tag_item(candidate.language, 'language', `${prefix}.language`)
    );
  }

  const genres = candidate.genres;
  if (genres != null) {
    if (!Array.isArray(genres)) {
      errors.push(`${prefix}.genres 必須為陣列`);
    } else {
      for (let g = 0; g < genres.length; g += 1) {
        errors.push.apply(
          errors,
          validate_tag_item(genres[g], 'genre', `${prefix}.genres[${g}]`)
        );
      }
    }
  }

  const moods = candidate.moods != null ? candidate.moods : candidate.contexts;
  if (moods != null) {
    if (!Array.isArray(moods)) {
      errors.push(`${prefix}.moods 必須為陣列`);
    } else {
      for (let m = 0; m < moods.length; m += 1) {
        errors.push.apply(
          errors,
          validate_tag_item(moods[m], 'context', `${prefix}.moods[${m}]`)
        );
      }
    }
  }

  if (candidate.genre_profile != null) {
    const gp_raw = candidate.genre_profile;
    const gp_norm = normalize_genre_profile(
      typeof gp_raw.primary_genre === 'object' && gp_raw.primary_genre
        ? {
            primary_genre: gp_raw.primary_genre.value,
            secondary_genres: (gp_raw.secondary_genres || []).map(function (x) {
              return typeof x === 'object' ? x.value : x;
            }),
            subgenres: (gp_raw.subgenres || []).map(function (x) {
              return typeof x === 'object' ? x.value : x;
            }),
          }
        : gp_raw
    );
    errors.push.apply(errors, validate_genre_profile(gp_norm).map(function (e) {
      return `${prefix}.genre_profile ${e}`;
    }));
    if (gp_raw.primary_genre && typeof gp_raw.primary_genre === 'object') {
      errors.push.apply(
        errors,
        validate_ai_genre_tag(gp_raw.primary_genre, `${prefix}.genre_profile.primary_genre`)
      );
    }
    const sec_tags = gp_raw.secondary_genres || [];
    for (let si = 0; si < sec_tags.length; si += 1) {
      if (sec_tags[si] && typeof sec_tags[si] === 'object') {
        errors.push.apply(
          errors,
          validate_ai_genre_tag(
            sec_tags[si],
            `${prefix}.genre_profile.secondary_genres[${si}]`
          )
        );
        if (!is_main_genre_code(sec_tags[si].value)) {
          errors.push(`${prefix}.genre_profile.secondary_genres[${si}] 主曲風代碼非法`);
        }
      }
    }
    const sub_tags = gp_raw.subgenres || [];
    for (let sj = 0; sj < sub_tags.length; sj += 1) {
      if (sub_tags[sj] && typeof sub_tags[sj] === 'object') {
        if (sub_tags[sj].confidence === CONFIDENCE_CONFIRMED) {
          errors.push(`${prefix}.genre_profile.subgenres[${sj}] 不得 confirmed`);
        }
        if (!SUBGENRES_BY_CODE[sub_tags[sj].value]) {
          errors.push(`${prefix}.genre_profile.subgenres[${sj}] 子曲風非法`);
        }
      }
    }
  }

  const special = candidate.special_types;
  if (special != null) {
    if (!Array.isArray(special)) {
      errors.push(`${prefix}.special_types 必須為陣列`);
    } else {
      for (let s = 0; s < special.length; s += 1) {
        errors.push.apply(
          errors,
          validate_tag_item(
            special[s],
            'special_type',
            `${prefix}.special_types[${s}]`
          )
        );
      }
    }
  }

  return errors;
}

/**
 * @param {object} doc
 * @param {object} sample_doc
 */
export function validate_ai_candidates_doc(doc, sample_doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') {
    throw new AiCandidatesValidationError(['ai-candidates 不是物件']);
  }
  if (doc.schema_version !== AI_CANDIDATES_SCHEMA_VERSION) {
    errors.push(`schema_version 預期 ${AI_CANDIDATES_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(doc.candidates)) {
    errors.push('candidates 必須為陣列');
    throw new AiCandidatesValidationError(errors);
  }

  const sample_size =
    sample_doc && sample_doc.track_count ? sample_doc.track_count : 30;
  if (doc.sample_size != null && doc.sample_size !== sample_size) {
    errors.push(`sample_size 與樣本不符（${doc.sample_size} vs ${sample_size}）`);
  }
  if (doc.candidates.length !== sample_size) {
    errors.push(
      `candidates 長度必須為 ${sample_size}，實際 ${doc.candidates.length}`
    );
  }

  const allowed_ids = {};
  const sample_ids = sample_doc && sample_doc.track_ids ? sample_doc.track_ids : [];
  for (let i = 0; i < sample_ids.length; i += 1) {
    allowed_ids[sample_ids[i]] = true;
  }

  const seen = {};
  for (let i = 0; i < doc.candidates.length; i += 1) {
    const c = doc.candidates[i];
    errors.push.apply(errors, validate_one_candidate(c, i));
    if (c && c.spotify_id) {
      if (!allowed_ids[c.spotify_id]) {
        errors.push(`candidates[${i}] 不在 sample-30 中：${c.spotify_id}`);
      }
      if (seen[c.spotify_id]) {
        errors.push(`重複 spotify_id：${c.spotify_id}`);
      }
      seen[c.spotify_id] = true;
    }
  }

  for (let j = 0; j < sample_ids.length; j += 1) {
    if (!seen[sample_ids[j]]) {
      errors.push(`缺少樣本曲目候選：${sample_ids[j]}`);
    }
  }

  if (errors.length) {
    throw new AiCandidatesValidationError(errors);
  }
  return doc;
}

/**
 * 正規化 moods -> contexts 命名供內部使用
 * @param {object} doc
 */
export function normalize_ai_candidates_doc(doc) {
  const normalized = JSON.parse(JSON.stringify(doc));
  normalized.schema_version = AI_CANDIDATES_SCHEMA_VERSION;
  for (let i = 0; i < normalized.candidates.length; i += 1) {
    const c = normalized.candidates[i];
    if (c.moods && !c.contexts) {
      c.contexts = c.moods;
    }
  }
  return normalized;
}

/**
 * @param {object} candidate
 * @param {number} index
 */
function validate_one_candidate_v2(candidate, index) {
  const errors = [];
  const prefix = `candidates[${index}]`;
  errors.push.apply(errors, validate_one_candidate(candidate, index));

  if (!candidate.genre_profile || typeof candidate.genre_profile !== 'object') {
    errors.push(`${prefix} 缺少 genre_profile（v2 必填）`);
    return errors;
  }
  const gp = candidate.genre_profile;
  if (!gp.primary_genre || typeof gp.primary_genre !== 'object') {
    errors.push(`${prefix}.genre_profile.primary_genre 必填且為標籤物件`);
  } else {
    errors.push.apply(
      errors,
      validate_ai_genre_tag(gp.primary_genre, `${prefix}.genre_profile.primary_genre`)
    );
    if (!is_main_genre_code(gp.primary_genre.value)) {
      errors.push(`${prefix}.genre_profile.primary_genre 主曲風代碼非法`);
    }
  }
  const sec = gp.secondary_genres || [];
  if (!Array.isArray(sec)) {
    errors.push(`${prefix}.genre_profile.secondary_genres 必須為陣列`);
  } else if (sec.length > 2) {
    errors.push(`${prefix}.genre_profile.secondary_genres 最多 2 個`);
  } else {
    for (let si = 0; si < sec.length; si += 1) {
      errors.push.apply(
        errors,
        validate_ai_genre_tag(sec[si], `${prefix}.genre_profile.secondary_genres[${si}]`)
      );
      if (!is_main_genre_code(sec[si].value)) {
        errors.push(`${prefix}.genre_profile.secondary_genres[${si}] 主曲風代碼非法`);
      }
    }
  }
  const subs = gp.subgenres || [];
  if (!Array.isArray(subs)) {
    errors.push(`${prefix}.genre_profile.subgenres 必須為陣列`);
  } else {
    for (let sj = 0; sj < subs.length; sj += 1) {
      if (!subs[sj] || typeof subs[sj] !== 'object') {
        errors.push(`${prefix}.genre_profile.subgenres[${sj}] 必須為標籤物件`);
        continue;
      }
      if (subs[sj].confidence === CONFIDENCE_CONFIRMED) {
        errors.push(`${prefix}.genre_profile.subgenres[${sj}] 不得 confirmed`);
      }
      if (typeof subs[sj].evidence !== 'string' || !subs[sj].evidence.trim()) {
        errors.push(`${prefix}.genre_profile.subgenres[${sj}].evidence 必填`);
      }
      if (!SUBGENRES_BY_CODE[subs[sj].value]) {
        errors.push(`${prefix}.genre_profile.subgenres[${sj}] 子曲風非法`);
      }
    }
    if (
      gp.primary_genre &&
      gp.primary_genre.value === GENRE_PRIMARY_UNKNOWN &&
      subs.length
    ) {
      errors.push(`${prefix}.genre_profile 主曲風未確認時不得有子曲風`);
    }
  }

  const gp_norm = genre_profile_from_ai_candidate(candidate);
  errors.push.apply(
    errors,
    validate_genre_profile(gp_norm).map(function (e) {
      return `${prefix}.genre_profile ${e}`;
    })
  );

  return errors;
}

/**
 * @param {object} doc
 * @param {object} sample_doc
 */
export function validate_ai_candidates_v2_doc(doc, sample_doc, opts) {
  const options = opts || {};
  const allow_partial = options.allow_partial === true;
  const errors = [];
  if (!doc || typeof doc !== 'object') {
    throw new AiCandidatesValidationError(['ai-candidates v2 不是物件']);
  }
  if (doc.schema_version !== AI_CANDIDATES_V2_SCHEMA_VERSION) {
    errors.push(`schema_version 預期 ${AI_CANDIDATES_V2_SCHEMA_VERSION}`);
  }
  if (doc.candidate_version !== 2) {
    errors.push('candidate_version 預期 2');
  }
  if (!Array.isArray(doc.candidates)) {
    errors.push('candidates 必須為陣列');
    throw new AiCandidatesValidationError(errors);
  }

  const sample_size =
    sample_doc && sample_doc.track_count ? sample_doc.track_count : 30;
  if (!allow_partial && doc.candidates.length !== sample_size) {
    errors.push(
      `candidates 長度必須為 ${sample_size}，實際 ${doc.candidates.length}`
    );
  }

  const allowed_ids = {};
  const sample_ids = sample_doc && sample_doc.track_ids ? sample_doc.track_ids : [];
  for (let i = 0; i < sample_ids.length; i += 1) {
    allowed_ids[sample_ids[i]] = true;
  }

  const seen = {};
  for (let i = 0; i < doc.candidates.length; i += 1) {
    const c = doc.candidates[i];
    errors.push.apply(errors, validate_one_candidate_v2(c, i));
    if (c && c.spotify_id) {
      if (!allowed_ids[c.spotify_id]) {
        errors.push(`candidates[${i}] 不在測試樣本中：${c.spotify_id}`);
      }
      if (seen[c.spotify_id]) {
        errors.push(`重複 spotify_id：${c.spotify_id}`);
      }
      seen[c.spotify_id] = true;
    }
  }

  if (!allow_partial) {
    for (let j = 0; j < sample_ids.length; j += 1) {
      if (!seen[sample_ids[j]]) {
        errors.push(`缺少樣本曲目候選：${sample_ids[j]}`);
      }
    }
  }

  if (errors.length) {
    throw new AiCandidatesValidationError(errors);
  }
  return doc;
}

/**
 * @param {object} doc
 */
export function normalize_ai_candidates_v2_doc(doc) {
  const normalized = JSON.parse(JSON.stringify(doc));
  normalized.schema_version = AI_CANDIDATES_V2_SCHEMA_VERSION;
  normalized.candidate_version = 2;
  for (let i = 0; i < normalized.candidates.length; i += 1) {
    const c = normalized.candidates[i];
    if (c.moods && !c.contexts) {
      c.contexts = c.moods;
    }
  }
  return normalized;
}
