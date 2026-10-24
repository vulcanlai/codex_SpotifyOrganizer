/**
 * 藝人名稱比對證據（與 match_scoring 共用邏輯，可追溯來源）
 */
import { token_set_ratio } from './match_scoring.js';

export const ARTIST_MATCH_STATUS = {
  verified: 'verified',
  unverified_cross_script: 'unverified_cross_script',
  mismatch: 'mismatch',
};

function norm_key(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function has_cjk_or_kana(s) {
  return /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(String(s || ''));
}

export function is_latin_dominant(s) {
  const t = String(s || '').trim();
  if (!t) {
    return false;
  }
  return !has_cjk_or_kana(t);
}

/**
 * 合併本機藝人名（含 extra，去重）
 * @param {import('./provider_base.js').ExternalTrackInput} input
 * @param {string[]} extra_artist_names
 */
export function merge_local_artist_names(input, extra_artist_names) {
  const seen = {};
  const out = [];
  function add(n) {
    const t = String(n || '').trim();
    if (!t) {
      return;
    }
    const k = norm_key(t);
    if (seen[k]) {
      return;
    }
    seen[k] = true;
    out.push(t);
  }
  const base = input && input.artists ? input.artists : [];
  for (let i = 0; i < base.length; i += 1) {
    add(base[i]);
  }
  const extra = extra_artist_names || [];
  for (let j = 0; j < extra.length; j += 1) {
    add(extra[j]);
  }
  return out;
}

/**
 * @param {string} local_name
 * @param {string} ext_name
 */
export function is_cross_script_name_pair(local_name, ext_name) {
  const a = String(local_name || '').trim();
  const b = String(ext_name || '').trim();
  if (!a || !b) {
    return false;
  }
  if (token_set_ratio(a, b) >= 0.25) {
    return false;
  }
  const a_lat = is_latin_dominant(a);
  const b_lat = is_latin_dominant(b);
  return a_lat !== b_lat;
}

/**
 * 多位合作藝人：逐本機名對 MB 陣列取最佳，並估算覆蓋
 * @param {string[]} local_names
 * @param {string[]} ext_names
 */
export function artist_overlap_metrics(local_names, ext_names) {
  const locals = local_names || [];
  const exts = ext_names || [];
  let artist_best_ratio = 0;
  let cross_script_only = true;
  let any_same_script_pair = false;
  let matched_local_slots = 0;

  for (let i = 0; i < locals.length; i += 1) {
    let best_for_local = 0;
    let local_cross_only = true;
    for (let j = 0; j < exts.length; j += 1) {
      const r = token_set_ratio(locals[i], exts[j]);
      if (r > best_for_local) {
        best_for_local = r;
      }
      if (r >= 0.25) {
        local_cross_only = false;
      }
      if (!is_cross_script_name_pair(locals[i], exts[j])) {
        any_same_script_pair = true;
      }
    }
    if (best_for_local >= 0.25) {
      matched_local_slots += 1;
    }
    if (best_for_local > artist_best_ratio) {
      artist_best_ratio = best_for_local;
    }
    if (!local_cross_only) {
      cross_script_only = false;
    }
  }

  if (!locals.length || !exts.length) {
    cross_script_only = false;
  } else if (artist_best_ratio >= 0.25) {
    cross_script_only = false;
  } else if (any_same_script_pair && artist_best_ratio < 0.25) {
    cross_script_only = false;
  }

  return {
    artist_best_ratio: artist_best_ratio,
    cross_script_only: cross_script_only,
    matched_local_slots: matched_local_slots,
    local_count: locals.length,
    ext_count: exts.length,
  };
}
