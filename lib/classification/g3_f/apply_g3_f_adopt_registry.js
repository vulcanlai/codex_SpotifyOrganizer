/**
 * 將 G3-F registry 採用結果套入 tags（inferred，低於 manual-overrides）
 */
import {
  DIMENSION_LANGUAGE,
  DIMENSION_CONTEXT,
  DIMENSION_SPECIAL,
  CONFIDENCE_INFERRED,
} from '../dimensions.js';
import {
  is_manual_dimension_locked,
  manual_override_blocks_g3_f_genre_adopt,
} from './manual_override_adopt_guard.js';

function g3_f_adopt_tag(dimension, value, method, evidence) {
  return {
    dimension,
    value,
    source: 'g3-f-adopt-registry.json',
    method: method || 'g3_f_adopt_inferred',
    confidence: CONFIDENCE_INFERRED,
    evidence: evidence || 'G3-F staged AI 採用（未人工確認）。',
    is_g3_f_adopt: true,
  };
}

function override_blocks_genre(override_row) {
  return manual_override_blocks_g3_f_genre_adopt(override_row);
}

function override_blocks_language(override_row) {
  return !!(
    override_row &&
    (override_row.language || is_manual_dimension_locked(override_row, 'language'))
  );
}

function override_blocks_context(override_row) {
  return !!(
    override_row &&
    ((Array.isArray(override_row.contexts) && override_row.contexts.length) ||
      is_manual_dimension_locked(override_row, 'context'))
  );
}

function override_blocks_special(override_row) {
  return !!(
    override_row &&
    ((Array.isArray(override_row.special_types) && override_row.special_types.length) ||
      is_manual_dimension_locked(override_row, 'special_type'))
  );
}

/**
 * @param {object[]} tags
 * @param {object|null} registry_entry
 * @param {object|null} override_row
 */
export function apply_g3_f_adopt_registry_to_tags(tags, registry_entry, override_row) {
  if (!registry_entry || registry_entry.status !== 'adopted') {
    return tags.slice();
  }
  const patch = registry_entry.adopted_classification || {};
  let out = tags.slice();

  function strip_non_manual(dim) {
    out = out.filter(function (t) {
      if (t.dimension !== dim) {
        return true;
      }
      return t.is_manual_override === true;
    });
  }

  if (patch.language && !override_blocks_language(override_row)) {
    strip_non_manual(DIMENSION_LANGUAGE);
    out.push(
      g3_f_adopt_tag(
        DIMENSION_LANGUAGE,
        patch.language,
        'g3_f_adopt_language',
        'G3-F AI 採用語言（inferred）。'
      )
    );
  }

  if (
    Array.isArray(patch.contexts) &&
    patch.contexts.length &&
    !override_blocks_context(override_row)
  ) {
    for (let c = 0; c < patch.contexts.length; c += 1) {
      const val = patch.contexts[c];
      const exists = out.some(function (t) {
        return t.dimension === DIMENSION_CONTEXT && t.value === val;
      });
      if (!exists) {
        out.push(
          g3_f_adopt_tag(
            DIMENSION_CONTEXT,
            val,
            'g3_f_adopt_context',
            'G3-F AI 採用情境（inferred）。'
          )
        );
      }
    }
  }

  if (
    Array.isArray(patch.special_types) &&
    patch.special_types.length &&
    !override_blocks_special(override_row)
  ) {
    strip_non_manual(DIMENSION_SPECIAL);
    for (let s = 0; s < patch.special_types.length; s += 1) {
      out.push(
        g3_f_adopt_tag(
          DIMENSION_SPECIAL,
          patch.special_types[s],
          'g3_f_adopt_special_type',
          'G3-F AI 採用特殊類型（inferred）。'
        )
      );
    }
  }

  if (override_blocks_genre(override_row)) {
    return out;
  }
  if (!patch.genre_profile) {
    return out;
  }
  return out;
}

/**
 * @param {object|null} registry_entry
 * @param {object|null} override_row
 */
export function resolve_g3_f_registry_genre_profile(registry_entry, override_row) {
  if (override_blocks_genre(override_row)) {
    return null;
  }
  if (!registry_entry || registry_entry.status !== 'adopted') {
    return null;
  }
  const patch = registry_entry.adopted_classification || {};
  return patch.genre_profile || null;
}
