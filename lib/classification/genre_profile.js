/**
 * 多重曲風 profile 建構、驗證與去重
 */
import {
  GENRE_PRIMARY_UNKNOWN,
  is_main_genre_code,
  SUBGENRES_BY_CODE,
} from './genre_taxonomy.js';
import { migrate_legacy_genre_labels } from './genre_migrate.js';
import { DIMENSION_GENRE } from './dimensions.js';

export const MAX_SECONDARY_GENRES = 2;

/**
 * @param {string[]} codes
 */
export function dedupe_main_genre_codes(codes) {
  const out = [];
  const seen = {};
  for (let i = 0; i < codes.length; i += 1) {
    const c = codes[i];
    if (!c || c === GENRE_PRIMARY_UNKNOWN || seen[c]) {
      continue;
    }
    if (!is_main_genre_code(c) || c === GENRE_PRIMARY_UNKNOWN) {
      continue;
    }
    seen[c] = true;
    out.push(c);
  }
  return out;
}

/**
 * @param {string[]} subgenres
 * @param {string} primary
 * @param {string[]} secondary
 */
export function filter_valid_subgenres(subgenres, primary, secondary) {
  const allowed_mains = dedupe_main_genre_codes([
    primary,
    ...(secondary || []),
  ]);
  if (primary === GENRE_PRIMARY_UNKNOWN || !allowed_mains.length) {
    return [];
  }
  const out = [];
  const seen = {};
  for (let i = 0; i < (subgenres || []).length; i += 1) {
    const code = subgenres[i];
    const row = SUBGENRES_BY_CODE[code];
    if (!row || seen[code]) {
      continue;
    }
    if (allowed_mains.indexOf(row.main) >= 0) {
      seen[code] = true;
      out.push(code);
    }
  }
  return out;
}

/**
 * @param {object} profile
 * @returns {string[]}
 */
export function validate_genre_profile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object') {
    return ['genre_profile 必須為物件'];
  }
  const primary = profile.primary_genre;
  if (primary == null || !is_main_genre_code(primary)) {
    errors.push('primary_genre 非法');
  }
  const sec = profile.secondary_genres || [];
  if (!Array.isArray(sec)) {
    errors.push('secondary_genres 必須為陣列');
  } else if (sec.length > MAX_SECONDARY_GENRES) {
    errors.push('secondary_genres 最多 2 個');
  } else {
    for (let i = 0; i < sec.length; i += 1) {
      if (!is_main_genre_code(sec[i]) || sec[i] === GENRE_PRIMARY_UNKNOWN) {
        errors.push('secondary_genres 含非法主曲風');
      }
    }
    const deduped = dedupe_main_genre_codes(sec);
    if (deduped.length !== sec.length) {
      errors.push('secondary_genres 不可重複');
    }
    if (primary !== GENRE_PRIMARY_UNKNOWN && sec.indexOf(primary) >= 0) {
      errors.push('secondary_genres 不可包含 primary_genre');
    }
  }
  const subs = profile.subgenres || [];
  if (!Array.isArray(subs)) {
    errors.push('subgenres 必須為陣列');
  } else if (primary === GENRE_PRIMARY_UNKNOWN && subs.length) {
    errors.push('主曲風未確認時不得有子曲風');
  } else {
    const valid = filter_valid_subgenres(subs, primary, sec);
    if (valid.length !== subs.length) {
      errors.push('subgenres 與主／次曲風關係不合法');
    }
  }
  return errors;
}

/**
 * @param {object} override_row
 * @param {object[]} tags
 */
export function build_track_genre_profile(tags, override_row, g3_f_registry_entry) {
  if (override_row && override_row.genre_profile) {
    const gp = normalize_genre_profile(override_row.genre_profile);
    return {
      ...gp,
      source: 'manual-overrides.json',
      confidence: 'confirmed',
    };
  }

  if (
    g3_f_registry_entry &&
    g3_f_registry_entry.status === 'adopted' &&
    g3_f_registry_entry.adopted_classification &&
    g3_f_registry_entry.adopted_classification.genre_profile
  ) {
    const gp = normalize_genre_profile(
      g3_f_registry_entry.adopted_classification.genre_profile
    );
    return {
      ...gp,
      source: 'g3-f-adopt-registry.json',
      confidence: 'inferred',
    };
  }

  const legacy_from_override =
    override_row && Array.isArray(override_row.genres) ? override_row.genres : [];
  const legacy_from_tags = [];
  const tag_list = tags || [];
  for (let i = 0; i < tag_list.length; i += 1) {
    const t = tag_list[i];
    if (t.dimension === DIMENSION_GENRE && t.value) {
      legacy_from_tags.push(t.value);
    }
  }
  const legacy =
    legacy_from_override.length > 0 ? legacy_from_override : legacy_from_tags;
  const migrated = migrate_legacy_genre_labels(legacy);
  const manual_confirmed = tag_list.some(function (t) {
    return t.dimension === DIMENSION_GENRE && t.is_manual_override;
  });

  return normalize_genre_profile({
    primary_genre: migrated.primary_genre,
    secondary_genres: migrated.secondary_genres,
    subgenres: [],
    legacy_genre_labels: migrated.legacy_genre_labels,
    unmigrated_legacy_labels: migrated.unmigrated_legacy_labels,
    migration_notes: migrated.migration_notes,
    source: manual_confirmed ? 'manual-overrides.json' : 'legacy_migration',
    confidence: manual_confirmed ? 'confirmed' : migrated.unmigrated_legacy_labels.length ? 'unknown' : 'inferred',
  });
}

/**
 * @param {object} raw
 */
export function normalize_genre_profile(raw) {
  const primary =
    raw.primary_genre === undefined || raw.primary_genre === null
      ? GENRE_PRIMARY_UNKNOWN
      : raw.primary_genre;
  const secondary = dedupe_main_genre_codes(raw.secondary_genres || []).slice(
    0,
    MAX_SECONDARY_GENRES
  );
  let primary_final = is_main_genre_code(primary) ? primary : GENRE_PRIMARY_UNKNOWN;
  const sec_clean = [];
  for (let i = 0; i < secondary.length; i += 1) {
    if (secondary[i] !== primary_final) {
      sec_clean.push(secondary[i]);
    }
  }
  const subgenres = filter_valid_subgenres(
    raw.subgenres || [],
    primary_final,
    sec_clean
  );
  return {
    primary_genre: primary_final,
    secondary_genres: sec_clean.slice(0, MAX_SECONDARY_GENRES),
    subgenres,
    legacy_genre_labels: Array.isArray(raw.legacy_genre_labels)
      ? raw.legacy_genre_labels.slice()
      : [],
    unmigrated_legacy_labels: Array.isArray(raw.unmigrated_legacy_labels)
      ? raw.unmigrated_legacy_labels.slice()
      : [],
    migration_notes: Array.isArray(raw.migration_notes) ? raw.migration_notes.slice() : [],
    source: raw.source || null,
    confidence: raw.confidence || 'unknown',
  };
}

function genre_code_from_profile_field(field) {
  if (field == null) {
    return null;
  }
  if (typeof field === 'string') {
    return field;
  }
  if (typeof field === 'object' && field.value) {
    return field.value;
  }
  return null;
}

function genre_codes_from_profile_list(list) {
  const out = [];
  for (let i = 0; i < (list || []).length; i += 1) {
    const code = genre_code_from_profile_field(list[i]);
    if (code) {
      out.push(code);
    }
  }
  return out;
}

/**
 * @param {object} candidate
 */
export function genre_profile_from_ai_candidate(candidate) {
  if (candidate.genre_profile) {
    const gp_raw = candidate.genre_profile;
    return normalize_genre_profile({
      primary_genre: genre_code_from_profile_field(gp_raw.primary_genre),
      secondary_genres: genre_codes_from_profile_list(gp_raw.secondary_genres),
      subgenres: genre_codes_from_profile_list(gp_raw.subgenres),
      legacy_genre_labels: gp_raw.legacy_genre_labels,
      unmigrated_legacy_labels: gp_raw.unmigrated_legacy_labels,
      migration_notes: gp_raw.migration_notes,
      source: 'cursor_ai',
      confidence: 'inferred',
    });
  }
  const legacy = (candidate.genres || []).map(function (g) {
    return g.value;
  });
  const migrated = migrate_legacy_genre_labels(legacy);
  return normalize_genre_profile({
    primary_genre: migrated.primary_genre,
    secondary_genres: migrated.secondary_genres,
    subgenres: [],
    legacy_genre_labels: legacy,
    unmigrated_legacy_labels: migrated.unmigrated_legacy_labels,
    source: 'cursor_ai',
    confidence: 'inferred',
  });
}

/**
 * @param {Record<string, object>} tracks_by_id
 */
export function count_primary_genre_tracks(tracks_by_id) {
  const counts = {};
  const ids = Object.keys(tracks_by_id);
  for (let i = 0; i < ids.length; i += 1) {
    const gp = tracks_by_id[ids[i]].genre_profile;
    if (!gp) {
      continue;
    }
    const key = gp.primary_genre || GENRE_PRIMARY_UNKNOWN;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/**
 * @param {Record<string, object>} tracks_by_id
 */
export function count_subgenre_tracks(tracks_by_id) {
  const counts = {};
  const ids = Object.keys(tracks_by_id);
  for (let i = 0; i < ids.length; i += 1) {
    const subs = (tracks_by_id[ids[i]].genre_profile || {}).subgenres || [];
    for (let s = 0; s < subs.length; s += 1) {
      counts[subs[s]] = (counts[subs[s]] || 0) + 1;
    }
  }
  return counts;
}
