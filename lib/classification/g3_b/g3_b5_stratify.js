/**
 * G3-B.5 七十首分層抽樣（固定 seed，不用 AI 語言當已確認）
 */
import crypto from 'node:crypto';
import { load_g3_source_bundle } from '../g3_evidence/source_loaders.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { load_g3_b_sample_from_g1 } from './sample.js';
import { decade_from_tags } from '../ai_sample_select.js';
import { DIMENSION_LANGUAGE } from '../dimensions.js';
import fs from 'node:fs';
import { G3_B5_SELECTION_SEED } from './paths_b5.js';

function stable_hash(seed, id) {
  return crypto.createHash('sha256').update(seed + ':' + id).digest('hex');
}

function has_hangul(s) {
  return /[\uAC00-\uD7AF]/.test(String(s || ''));
}
function has_kana(s) {
  return /[\u3040-\u309F\u30A0-\u30FF]/.test(String(s || ''));
}
function has_cjk(s) {
  return /[\u4E00-\u9FFF]/.test(String(s || ''));
}
function is_mostly_latin_title(s) {
  const t = String(s || '').trim();
  if (!t) {
    return false;
  }
  let latin = 0;
  let other = 0;
  for (let i = 0; i < t.length; i += 1) {
    const c = t.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 32) {
      latin += 1;
    } else if (c > 127) {
      other += 1;
    }
  }
  return latin > 0 && other === 0;
}

/**
 * 索引語言標籤（非 AI 候選）
 */
function index_language_bucket(index_row) {
  const tags = (index_row && index_row.tags) || [];
  for (let i = 0; i < tags.length; i += 1) {
    if (tags[i].dimension === DIMENSION_LANGUAGE) {
      const v = tags[i].value;
      if (v && v !== '未確認') {
        return 'index_tag:' + v;
      }
    }
  }
  return 'index_tag:未確認';
}

/**
 * 歌名／藝人文字線索（非演唱語言確認）
 */
function title_script_bucket(title, artists) {
  const a = (artists || []).join(' ');
  if (/live|remix|acoustic|- live|\(live\)/i.test(title)) {
    return 'version_variant';
  }
  if (has_hangul(title)) {
    return 'script_korean';
  }
  if (has_kana(title)) {
    return 'script_japanese';
  }
  if (has_cjk(title)) {
    return 'script_cjk';
  }
  if (is_mostly_latin_title(title)) {
    if (has_cjk(a)) {
      return 'script_latin_title_cjk_artist';
    }
    return 'script_latin';
  }
  return 'script_other';
}

function instrumental_hint(title, index_row) {
  const tags = (index_row && index_row.tags) || [];
  for (let i = 0; i < tags.length; i += 1) {
    if (tags[i].dimension === 'special_type' && tags[i].value === '純音樂') {
      return 'instrumental_index_tag';
    }
  }
  if (/instrumental|ギター|ソロ|off vocal|伴奏/i.test(title)) {
    return 'instrumental_title_hint';
  }
  return 'vocal_or_unknown';
}

/**
 * @param {string} id
 * @param {object} ev
 * @param {object} index_row
 */
export function build_stratify_row(id, ev, index_row) {
  const title = ev.identity.title || '';
  const artists = ev.identity.artists || [];
  return {
    track_id: id,
    title: title,
    artists: artists,
    decade: decade_from_tags(index_row || {}),
    index_language: index_language_bucket(index_row),
    title_script: title_script_bucket(title, artists),
    vocal_hint: instrumental_hint(title, index_row),
    enrichment_complete: !!ev.identity.enrichment_cache_complete,
    has_isrc: !!ev.identity.isrc,
    has_ai_candidate: (ev.classification_candidates || []).length > 0,
    mb_g2_matched:
      ev.verification_status &&
      ev.verification_status.g2 &&
      ev.verification_status.g2.verify_status === 'matched',
    multi_artist: artists.length > 1 || (String(artists[0] || '').indexOf(',') >= 0),
    human_locked: !!(ev.human_confirmation && ev.human_confirmation.locked),
  };
}

function pick_diverse(rows, already, n, seed) {
  const used = {};
  for (let i = 0; i < already.length; i += 1) {
    used[already[i]] = true;
  }
  const pool = rows.filter(function (r) {
    return !used[r.track_id] && !r.human_locked;
  });
  const picked = [];
  const picked_rows = [];
  let guard = 0;
  while (picked.length < n && pool.length && guard < 2000) {
    guard += 1;
    pool.sort(function (a, b) {
      let sa = 0;
      let sb = 0;
      const pd = {};
      const ps = {};
      const pl = {};
      for (let i = 0; i < picked_rows.length; i += 1) {
        pd[picked_rows[i].decade] = true;
        ps[picked_rows[i].title_script] = true;
        pl[picked_rows[i].index_language] = true;
      }
      if (!pd[a.decade]) {
        sa += 4;
      }
      if (!pd[b.decade]) {
        sb += 4;
      }
      if (!ps[a.title_script]) {
        sa += 3;
      }
      if (!ps[b.title_script]) {
        sb += 3;
      }
      if (!pl[a.index_language]) {
        sa += 2;
      }
      if (!pl[b.index_language]) {
        sb += 2;
      }
      if (a.has_ai_candidate !== b.has_ai_candidate) {
        sa += a.has_ai_candidate ? 1 : 2;
        sb += b.has_ai_candidate ? 1 : 2;
      }
      if (a.enrichment_complete !== b.enrichment_complete) {
        sa += a.enrichment_complete ? 0 : 2;
        sb += b.enrichment_complete ? 0 : 2;
      }
      if (sa !== sb) {
        return sb - sa;
      }
      return stable_hash(seed, a.track_id) < stable_hash(seed, b.track_id) ? -1 : 1;
    });
    const best = pool.shift();
    picked.push(best.track_id);
    picked_rows.push(best);
  }
  return { picked_ids: picked, picked_rows: picked_rows };
}

/**
 * @param {number} count
 */
export function select_g3_b5_new_sample_ids(count) {
  const target = count || 70;
  const cohort30 = load_g3_b_sample_from_g1().track_ids;
  const exclude = {};
  for (let i = 0; i < cohort30.length; i += 1) {
    exclude[cohort30[i]] = true;
  }

  const ev_path = file_g3_evidence_index();
  if (!fs.existsSync(ev_path)) {
    throw new Error('缺少 evidence-index.json');
  }
  const ev_index = JSON.parse(fs.readFileSync(ev_path, 'utf8'));
  const bundle = load_g3_source_bundle();
  const index = bundle.index.tracks_by_id || {};

  /** @type {object[]} */
  const rows = [];
  const ids = Object.keys(ev_index.tracks).sort();
  for (let j = 0; j < ids.length; j += 1) {
    const id = ids[j];
    if (exclude[id]) {
      continue;
    }
    const ev = ev_index.tracks[id];
    if (!ev || !ev.identity || !ev.identity.title) {
      continue;
    }
    rows.push(build_stratify_row(id, ev, index[id]));
  }

  const result = pick_diverse(rows, cohort30, target, G3_B5_SELECTION_SEED);
  return {
    seed: G3_B5_SELECTION_SEED,
    excluded_cohort_30: cohort30.length,
    pool_size: rows.length,
    selected_ids: result.picked_ids,
    selected_rows: result.picked_rows,
    cohort_30_ids: cohort30,
  };
}
