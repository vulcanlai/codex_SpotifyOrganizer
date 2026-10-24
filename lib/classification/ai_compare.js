/**
 * v1 / v2 AI 候選比較
 */
import { genre_profile_from_ai_candidate } from './genre_profile.js';
import { GENRE_PRIMARY_UNKNOWN } from './genre_taxonomy.js';

function profile_from_candidate(c) {
  if (!c) {
    return null;
  }
  return genre_profile_from_ai_candidate(c);
}

function lang_value(c) {
  return c && c.language ? c.language.value : null;
}

function ctx_values(c) {
  const arr = (c && (c.contexts || c.moods)) || [];
  return arr.map(function (x) {
    return x.value;
  });
}

function spec_values(c) {
  return ((c && c.special_types) || []).map(function (x) {
    return x.value;
  });
}

/**
 * @param {object|null} v1
 * @param {object|null} v2
 */
export function compare_one_candidate(v1, v2) {
  const p1 = profile_from_candidate(v1);
  const p2 = profile_from_candidate(v2);
  const changed = {
    primary_genre: (p1 && p1.primary_genre) !== (p2 && p2.primary_genre),
    secondary_genres:
      JSON.stringify((p1 && p1.secondary_genres) || []) !==
      JSON.stringify((p2 && p2.secondary_genres) || []),
    subgenres:
      JSON.stringify((p1 && p1.subgenres) || []) !==
      JSON.stringify((p2 && p2.subgenres) || []),
    language: lang_value(v1) !== lang_value(v2),
    contexts: JSON.stringify(ctx_values(v1)) !== JSON.stringify(ctx_values(v2)),
    special_types:
      JSON.stringify(spec_values(v1)) !== JSON.stringify(spec_values(v2)),
  };
  const any =
    changed.primary_genre ||
    changed.secondary_genres ||
    changed.subgenres ||
    changed.language ||
    changed.contexts ||
    changed.special_types;
  return {
    changed: any,
    fields: changed,
    v1_profile: p1,
    v2_profile: p2,
    v1_language: lang_value(v1),
    v2_language: lang_value(v2),
    v1_contexts: ctx_values(v1),
    v2_contexts: ctx_values(v2),
    v1_special_types: spec_values(v1),
    v2_special_types: spec_values(v2),
  };
}

/**
 * @param {object|null} v1_doc
 * @param {object|null} v2_doc
 * @param {string[]} sample_ids
 */
export function compare_ai_candidate_docs(v1_doc, v2_doc, sample_ids) {
  const items = [];
  let changed_count = 0;
  let unknown_primary_v2 = 0;
  const primary_counts = {};
  const sub_counts = {};

  for (let i = 0; i < sample_ids.length; i += 1) {
    const id = sample_ids[i];
    const c1 = find_c(v1_doc, id);
    const c2 = find_c(v2_doc, id);
    const cmp = compare_one_candidate(c1, c2);
    if (cmp.changed) {
      changed_count += 1;
    }
    const p2 = cmp.v2_profile;
    if (p2) {
      const pk = p2.primary_genre || GENRE_PRIMARY_UNKNOWN;
      primary_counts[pk] = (primary_counts[pk] || 0) + 1;
      if (pk === GENRE_PRIMARY_UNKNOWN) {
        unknown_primary_v2 += 1;
      }
      for (let s = 0; s < (p2.subgenres || []).length; s += 1) {
        const sk = p2.subgenres[s];
        sub_counts[sk] = (sub_counts[sk] || 0) + 1;
      }
    }
    items.push({ spotify_id: id, compare: cmp, v1: c1, v2: c2 });
  }

  return {
    track_count: sample_ids.length,
    changed_count,
    unknown_primary_v2,
    primary_genre_counts: primary_counts,
    subgenre_counts: sub_counts,
    items,
  };
}

function find_c(doc, id) {
  const list = doc && doc.candidates ? doc.candidates : [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].spotify_id === id) {
      return list[i];
    }
  }
  return null;
}
