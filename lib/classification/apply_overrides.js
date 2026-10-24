/**
 * 人工覆寫優先於自動分類
 */
import {
  DIMENSION_LANGUAGE,
  DIMENSION_GENRE,
  DIMENSION_CONTEXT,
  DIMENSION_SPECIAL,
  CONFIDENCE_CONFIRMED,
} from './dimensions.js';

function manual_tag(dimension, value, evidence, method) {
  return {
    dimension,
    value,
    source: 'manual-overrides.json',
    method: method || 'manual_set',
    confidence: CONFIDENCE_CONFIRMED,
    evidence: evidence || '使用者人工覆寫。',
    is_manual_override: true,
  };
}

/**
 * @param {object[]} auto_tags
 * @param {object|null} override_row
 */
export function apply_manual_overrides_to_tags(auto_tags, override_row) {
  if (!override_row) {
    return auto_tags.slice();
  }
  const exclude = Array.isArray(override_row.exclude_dimensions)
    ? override_row.exclude_dimensions
    : [];
  let tags = auto_tags.filter(function (t) {
    return exclude.indexOf(t.dimension) < 0;
  });

  function strip_dimension(dim) {
    tags = tags.filter(function (t) {
      return t.dimension !== dim || t.is_manual_override === true;
    });
  }

  if (override_row.language) {
    strip_dimension(DIMENSION_LANGUAGE);
    tags.push(
      manual_tag(
        DIMENSION_LANGUAGE,
        override_row.language,
        '人工指定語言。',
        'manual_language'
      )
    );
  }

  if (Array.isArray(override_row.genres) && override_row.genres.length) {
    strip_dimension(DIMENSION_GENRE);
    for (let i = 0; i < override_row.genres.length; i += 1) {
      tags.push(
        manual_tag(
          DIMENSION_GENRE,
          override_row.genres[i],
          '人工指定曲風。',
          'manual_genre'
        )
      );
    }
  }
  const remove_genres = override_row.remove_genres || [];
  if (remove_genres.length) {
    tags = tags.filter(function (t) {
      if (t.dimension !== DIMENSION_GENRE) {
        return true;
      }
      return remove_genres.indexOf(t.value) < 0;
    });
  }

  if (Array.isArray(override_row.contexts) && override_row.contexts.length) {
    for (let c = 0; c < override_row.contexts.length; c += 1) {
      const val = override_row.contexts[c];
      const exists = tags.some(function (t) {
        return t.dimension === DIMENSION_CONTEXT && t.value === val;
      });
      if (!exists) {
        tags.push(
          manual_tag(
            DIMENSION_CONTEXT,
            val,
            '人工指定情境。',
            'manual_context'
          )
        );
      }
    }
  }
  const remove_contexts = override_row.remove_contexts || [];
  if (remove_contexts.length) {
    tags = tags.filter(function (t) {
      if (t.dimension !== DIMENSION_CONTEXT) {
        return true;
      }
      return remove_contexts.indexOf(t.value) < 0;
    });
  }

  if (Array.isArray(override_row.special_types) && override_row.special_types.length) {
    strip_dimension(DIMENSION_SPECIAL);
    for (let s = 0; s < override_row.special_types.length; s += 1) {
      tags.push(
        manual_tag(
          DIMENSION_SPECIAL,
          override_row.special_types[s],
          '人工指定特殊類型。',
          'manual_special_type'
        )
      );
    }
  }
  const remove_special = override_row.remove_special_types || [];
  if (remove_special.length) {
    tags = tags.filter(function (t) {
      if (t.dimension !== DIMENSION_SPECIAL) {
        return true;
      }
      return remove_special.indexOf(t.value) < 0;
    });
  }

  return tags;
}
