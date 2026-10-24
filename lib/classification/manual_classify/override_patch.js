/**
 * 人工覆寫 patch 合併（冪等、去重）
 */
import { validate_genre_profile, normalize_genre_profile } from '../genre_profile.js';
import { LANGUAGE_VALUES } from '../dimensions.js';
import { EMOTION_CODES } from '../g3_emotion/emotion_taxonomy.js';
import { is_valid_spotify_id } from './spotify_id_parse.js';

export const MANUAL_CLASSIFY_SOURCE = 'manual:classify-cli';

/** @typedef {'language'|'genre_profile'|'context'|'special_type'|'mvp_playlists'|'emotion_playlists'} LockedDimension */

/**
 * @param {string[]} ids
 */
export function dedupe_sorted_ids(ids) {
  return Array.from(new Set(ids || [])).sort();
}

/**
 * @param {object|null} prev
 * @param {object} incoming
 */
export function merge_track_override_patch(prev, incoming) {
  const base = prev ? { ...prev } : {};
  const out = { ...base };

  out.source = incoming.source || base.source || MANUAL_CLASSIFY_SOURCE;
  out.updated_at = new Date().toISOString();

  if (incoming.language !== undefined) {
    out.language = incoming.language;
  }
  if (incoming.genre_profile !== undefined) {
    out.genre_profile = incoming.genre_profile;
  }
  if (incoming.genres !== undefined) {
    out.genres = incoming.genres;
  }
  if (incoming.contexts !== undefined) {
    out.contexts = dedupe_sorted_ids(incoming.contexts);
  }
  if (incoming.special_types !== undefined) {
    out.special_types = dedupe_sorted_ids(incoming.special_types);
  }

  if (incoming.mvp_playlist_ids !== undefined) {
    out.mvp_playlist_ids = dedupe_sorted_ids([
      ...(base.mvp_playlist_ids || []),
      ...(incoming.mvp_playlist_ids || []),
    ]);
  }
  if (incoming.emotion_playlist_ids !== undefined) {
    out.emotion_playlist_ids = dedupe_sorted_ids([
      ...(base.emotion_playlist_ids || []),
      ...(incoming.emotion_playlist_ids || []),
    ]);
  }
  if (incoming.replace_mvp_playlist_ids === true && incoming.mvp_playlist_ids) {
    out.mvp_playlist_ids = dedupe_sorted_ids(incoming.mvp_playlist_ids);
  }
  if (incoming.replace_emotion_playlist_ids === true && incoming.emotion_playlist_ids) {
    out.emotion_playlist_ids = dedupe_sorted_ids(incoming.emotion_playlist_ids);
  }

  if (incoming.locked_dimensions !== undefined) {
    out.locked_dimensions = dedupe_locked_dimensions([
      ...(base.locked_dimensions || []),
      ...(incoming.locked_dimensions || []),
    ]);
  }
  if (incoming.note_zh !== undefined) {
    out.note_zh = incoming.note_zh;
  }

  return out;
}

/**
 * @param {string[]} dims
 */
export function dedupe_locked_dimensions(dims) {
  const allowed = {
    language: true,
    genre_profile: true,
    context: true,
    special_type: true,
    mvp_playlists: true,
    emotion_playlists: true,
  };
  const out = [];
  const seen = {};
  for (let i = 0; i < dims.length; i += 1) {
    const d = dims[i];
    if (!allowed[d] || seen[d]) {
      continue;
    }
    seen[d] = true;
    out.push(d);
  }
  return out;
}

/**
 * @param {object} patch
 */
export function validate_manual_classify_patch(patch) {
  /** @type {string[]} */
  const errors = [];
  if (patch.language != null && LANGUAGE_VALUES.indexOf(patch.language) < 0) {
    errors.push('language 非法：' + patch.language);
  }
  if (patch.genre_profile != null) {
    const gp = normalize_genre_profile(patch.genre_profile);
    const gp_err = validate_genre_profile(gp);
    for (let i = 0; i < gp_err.length; i += 1) {
      errors.push('genre_profile:' + gp_err[i]);
    }
  }
  if (Array.isArray(patch.mvp_playlist_ids)) {
    for (let i = 0; i < patch.mvp_playlist_ids.length; i += 1) {
      const pid = patch.mvp_playlist_ids[i];
      if (typeof pid !== 'string' || pid.indexOf('lg:v2:') !== 0) {
        errors.push('mvp_playlist_id 非法：' + pid);
      }
    }
  }
  if (Array.isArray(patch.emotion_playlist_ids)) {
    for (let i = 0; i < patch.emotion_playlist_ids.length; i += 1) {
      const eid = patch.emotion_playlist_ids[i];
      const code = eid.replace(/^emotion:/, '');
      if (EMOTION_CODES.indexOf(code) < 0) {
        errors.push('emotion_playlist_id 非法：' + eid);
      }
    }
  }
  return { ok: errors.length === 0, errors: errors, normalized_genre_profile: patch.genre_profile ? normalize_genre_profile(patch.genre_profile) : null };
}

/**
 * @param {object|null} row
 */
export function manual_membership_from_override_row(row) {
  if (!row) {
    return null;
  }
  const mvp = row.mvp_playlist_ids || [];
  const emo = row.emotion_playlist_ids || [];
  if (!mvp.length && !emo.length) {
    return null;
  }
  return {
    mvp_playlist_ids: dedupe_sorted_ids(mvp),
    emotion_playlist_ids: dedupe_sorted_ids(emo),
    source: 'manual-overrides.json',
  };
}

/**
 * @param {object} a
 * @param {object} b
 */
export function override_row_semantically_equal(a, b) {
  return JSON.stringify(stable_override_for_compare(a)) === JSON.stringify(stable_override_for_compare(b));
}

function stable_override_for_compare(row) {
  if (!row) {
    return null;
  }
  const copy = { ...row };
  delete copy.updated_at;
  return copy;
}

/**
 * @param {object} row
 * @param {string} field_group
 */
export function build_revoke_patch(row, field_group) {
  if (!row) {
    return { action: 'noop', reason_zh: '無人工覆寫' };
  }
  if (field_group === 'all') {
    return { action: 'clear_row' };
  }
  const patch = { ...row };
  if (field_group === 'genre') {
    delete patch.genre_profile;
    delete patch.genres;
    patch.locked_dimensions = (patch.locked_dimensions || []).filter(function (d) {
      return d !== 'genre_profile';
    });
  } else if (field_group === 'playlists') {
    delete patch.mvp_playlist_ids;
    delete patch.emotion_playlist_ids;
    patch.locked_dimensions = (patch.locked_dimensions || []).filter(function (d) {
      return d !== 'mvp_playlists' && d !== 'emotion_playlists';
    });
  } else if (field_group === 'language') {
    delete patch.language;
    patch.locked_dimensions = (patch.locked_dimensions || []).filter(function (d) {
      return d !== 'language';
    });
  } else if (field_group === 'context') {
    delete patch.contexts;
    patch.locked_dimensions = (patch.locked_dimensions || []).filter(function (d) {
      return d !== 'context';
    });
  }
  const keys = Object.keys(patch).filter(function (k) {
    return k !== 'updated_at' && k !== 'source' && patch[k] !== undefined;
  });
  if (keys.length === 0) {
    return { action: 'clear_row' };
  }
  return { action: 'replace_row', row: patch };
}

/**
 * @param {string} track_id
 */
export function assert_valid_track_id_for_patch(track_id) {
  if (!is_valid_spotify_id(track_id)) {
    return { ok: false, error: 'invalid_track_id' };
  }
  return { ok: true };
}
