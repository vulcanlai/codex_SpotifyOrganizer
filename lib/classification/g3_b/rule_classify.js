/**
 * G3-B 離線規則分類（非 AI API）
 */
import { GENRE_PRIMARY_UNKNOWN, MAIN_GENRES } from '../genre_taxonomy.js';
import { TIER_LOW, TIER_MEDIUM, TIER_HIGH } from '../confidence_tier.js';
import { LANGUAGE_VALUES } from '../dimensions.js';
import { resolve_classification_queue_state } from './queue_state.js';

const MAIN_CODES = {};
for (let i = 0; i < MAIN_GENRES.length; i += 1) {
  MAIN_CODES[MAIN_GENRES[i].code] = true;
}

/**
 * @param {object} evidence_doc from G3-A
 */
export function rule_classify_track(evidence_doc) {
  const id = evidence_doc.track_id;
  const uncertainty = [];
  const evidence_refs = [];
  const conflicts = evidence_doc.conflicts ? evidence_doc.conflicts.slice() : [];

  if (evidence_doc.human_confirmation && evidence_doc.human_confirmation.locked) {
    return build_human_locked(evidence_doc, uncertainty, evidence_refs, conflicts);
  }

  let tier = TIER_LOW;
  let kind = 'unknown';
  /** @type {object|null} */
  let genre_profile = {
    primary_genre: GENRE_PRIMARY_UNKNOWN,
    secondary_genres: [],
    subgenres: [],
    source: 'g3_b_rules',
    confidence: 'unknown',
  };
  let language = {
    value: '未確認',
    source: 'g3_b_rules',
    confidence: 'unknown',
    method: 'default_unknown',
  };

  const mb_verified = find_mb_recording_fact(evidence_doc, evidence_refs);
  const mb_tags = find_mb_tags_inference(evidence_doc, evidence_refs);

  if (mb_verified) {
    kind = 'evidence_direct';
    tier = TIER_MEDIUM;
    if (mb_tags && mb_tags.value) {
      const inferred = infer_genre_from_mb_tags(mb_tags.value);
      if (inferred.primary !== GENRE_PRIMARY_UNKNOWN) {
        genre_profile = {
          primary_genre: inferred.primary,
          secondary_genres: [],
          subgenres: [],
          source: 'musicbrainz_recording',
          confidence: 'inferred',
          method: 'mb_tags_mapped',
          evidence: 'MB 錄音已可靠 matched；標籤映射為推論，非已確認主曲風',
        };
        kind = 'inference';
      }
    } else {
      uncertainty.push('MB 錄音已 matched 但無可用 genre tags');
    }
  } else if (mb_tags) {
    kind = 'inference';
    tier = TIER_LOW;
    const inferred = infer_genre_from_mb_tags(mb_tags.value);
    genre_profile.primary_genre = inferred.primary;
    genre_profile.confidence = 'inferred';
    genre_profile.method = 'mb_tags_weak';
    genre_profile.evidence = mb_tags.note;
    uncertainty.push('MusicBrainz 錄音未可靠確認，標籤僅弱推論');
  }

  const unverified = has_unverified_cross_script(evidence_doc);
  if (unverified) {
    tier = TIER_LOW;
    uncertainty.push('藝人跨語系尚未核實，不得提升可信度');
  }

  if (has_ai_candidate(evidence_doc)) {
    uncertainty.push('存在 AI 候選，規則草稿不採為事實；請見 ai-pending 或匯入 AI 草稿');
  }

  if (genre_profile.primary_genre === GENRE_PRIMARY_UNKNOWN) {
    kind = kind === 'unknown' ? 'unknown' : kind;
    uncertainty.push('主曲風無充分證據');
  }

  tier = cap_tier_for_uncertainty(tier, uncertainty);

  const draft_partial = {
    track_id: id,
    classification_kind: kind,
    genre_profile: genre_profile,
    language: language,
    confidence_tier: tier,
    uncertainty: uncertainty,
    evidence_refs: evidence_refs,
    conflicts: conflicts,
    human_locked: false,
    notes: [],
  };
  const queue = resolve_classification_queue_state(evidence_doc, draft_partial);

  return Object.assign(draft_partial, {
    ai_pending: queue.ai_pending,
    queue_state: queue.queue_state,
    queue_reason_zh: queue.reason_zh,
    needs_ai_generation: queue.needs_ai_generation,
  });
}

function build_human_locked(doc, uncertainty, evidence_refs, conflicts) {
  push_ref(doc, 'human_confirmation', evidence_refs);
  const gp = extract_index_genre_profile(doc);
  const lang = extract_index_language(doc);
  return {
    track_id: doc.track_id,
    classification_kind: 'human_locked',
    genre_profile: gp,
    language: lang,
    confidence_tier: TIER_HIGH,
    uncertainty: uncertainty,
    evidence_refs: evidence_refs,
    conflicts: conflicts,
    human_locked: true,
    ai_pending: false,
    queue_state: 'human_confirmed',
    queue_reason_zh: '人工確認',
    needs_ai_generation: false,
    notes: ['沿用人工確認；G3-B 規則不覆寫'],
  };
}

function extract_index_genre_profile(doc) {
  const h = doc.human_confirmation || {};
  const ev = find_evidence(doc, 'human_confirmation');
  const val = ev && ev.value ? ev.value : {};
  const gp = val.genre_profile;
  if (gp) {
    return {
      primary_genre: gp.primary_genre || GENRE_PRIMARY_UNKNOWN,
      secondary_genres: gp.secondary_genres || [],
      subgenres: gp.subgenres || [],
      source: gp.source || 'human_confirmation',
      confidence: 'confirmed',
    };
  }
  return {
    primary_genre: GENRE_PRIMARY_UNKNOWN,
    secondary_genres: [],
    subgenres: [],
    source: 'human_confirmation',
    confidence: 'confirmed',
  };
}

function extract_index_language(doc) {
  const tags = doc.evidence || [];
  for (let i = 0; i < tags.length; i += 1) {
    const e = tags[i];
    if (e.field === 'classification_tag:language') {
      const v = e.value;
      if (LANGUAGE_VALUES.indexOf(v) >= 0) {
        return {
          value: v,
          source: e.source,
          confidence: e.is_direct_fact ? 'confirmed' : 'inferred',
          method: 'index_tag',
        };
      }
    }
  }
  return {
    value: '未確認',
    source: 'g3_b_rules',
    confidence: 'unknown',
  };
}

function find_mb_recording_fact(doc, refs) {
  const v = doc.verification_status || {};
  const layer = v.g2_1_offline || v.g2 || v.g1;
  if (!layer) {
    return null;
  }
  if (layer.verify_status !== 'matched') {
    return null;
  }
  if (layer.pending_verification || layer.artist_verified === false) {
    return null;
  }
  if (layer.artist_match_status === 'unverified_cross_script') {
    return null;
  }
  const fact = (doc.facts || []).find(function (f) {
    return f.field === 'musicbrainz_recording';
  });
  if (fact) {
    push_ref(doc, fact.field, refs);
    return fact;
  }
  return null;
}

function find_mb_tags_inference(doc, refs) {
  const ev = (doc.evidence || []).find(function (e) {
    return e.field === 'musicbrainz_genre_tags';
  });
  if (!ev) {
    return null;
  }
  push_ref(doc, ev.field, refs);
  return {
    value: ev.value,
    note: ev.note || 'MB 標籤',
  };
}

function infer_genre_from_mb_tags(tags) {
  const list = tags || [];
  const joined = list.join(' ').toLowerCase();
  if (joined.indexOf('pop') >= 0) {
    return { primary: 'pop' };
  }
  if (joined.indexOf('rock') >= 0) {
    return { primary: 'rock' };
  }
  if (joined.indexOf('jazz') >= 0) {
    return { primary: 'jazz' };
  }
  if (joined.indexOf('electronic') >= 0) {
    return { primary: 'electronic' };
  }
  return { primary: GENRE_PRIMARY_UNKNOWN };
}

function has_unverified_cross_script(doc) {
  const v = doc.verification_status || {};
  const layers = [v.g2_1_offline, v.g2, v.g1];
  for (let i = 0; i < layers.length; i += 1) {
    if (layers[i] && layers[i].artist_match_status === 'unverified_cross_script') {
      return true;
    }
  }
  return false;
}

function has_ai_candidate(doc) {
  return (doc.classification_candidates || []).length > 0;
}

function push_ref(doc, field, refs) {
  refs.push({ field: field, track_id: doc.track_id });
}

function find_evidence(doc, field) {
  const list = doc.evidence || [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].field === field) {
      return list[i];
    }
  }
  return null;
}

function cap_tier_for_uncertainty(tier, uncertainty) {
  if (uncertainty.length >= 2 && tier === TIER_HIGH) {
    return TIER_MEDIUM;
  }
  return tier;
}

export function validate_genre_profile_draft(gp) {
  if (!gp || !gp.primary_genre) {
    return false;
  }
  if (gp.primary_genre === GENRE_PRIMARY_UNKNOWN) {
    return true;
  }
  return !!MAIN_CODES[gp.primary_genre];
}
