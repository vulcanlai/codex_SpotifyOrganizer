/**
 * 智慧歌單 MVP：語言 × 曲風 ＋ 情緒（暫定）
 */
import fs from 'node:fs';
import {
  MAIN_GENRES,
  GENRE_PRIMARY_UNKNOWN,
  is_main_genre_code,
} from './genre_taxonomy.js';
import { DIMENSION_CONTEXT } from './dimensions.js';
import { FILE_CLASSIFICATION_INDEX } from './paths.js';
import {
  EMOTION_CODES,
  EMOTIONS_BY_CODE,
  emotion_label_zh,
} from './g3_emotion/emotion_taxonomy.js';
import {
  LANG_BUCKET_UNKNOWN_INSTRUMENTAL,
  resolve_language_bucket,
  mvp_lang_genre_playlist_id,
  mvp_lang_genre_playlist_label_zh,
  MVP_LANG_GENRE_PLAYLIST_ID_PREFIX,
} from './mvp_language_buckets.js';
import { human_removed_ids_by_mvp_id } from '../managed_playlists/sync_respect.js';

export const MVP_PLAYLIST_SCHEMA_VERSION = 2;

/** @deprecated 舊版僅曲風 ID 前綴；sync manifest 請用 lg:v2: */
export const LEGACY_GENRE_PLAYLIST_ID_PREFIX = 'genre:';

/** 情境 → 情緒「暫定參考」映射（≠ 已驗證 emotion） */
export const TENTATIVE_CONTEXT_TO_EMOTION = {
  放鬆: 'relaxed_comfort',
  睡前: 'late_night_calm',
  運動: 'energetic_passion',
  派對: 'upbeat_joy',
  開車: 'upbeat_joy',
};

export const EMOTION_SOURCE_TENTATIVE_CONTEXT = 'tentative_context_proxy';
export const EMOTION_SOURCE_MANUAL = 'manual_confirmed';
export const EMOTION_SOURCE_NONE = 'none';

/**
 * @param {object|null} row
 */
export function track_has_display_title(row) {
  const name = row && row.display && row.display.name;
  return typeof name === 'string' && name.trim().length > 0;
}

/**
 * @param {object} row
 */
export function genre_playlist_membership(row) {
  const gp = row.genre_profile || {};
  const pk = gp.primary_genre;
  if (!pk || pk === GENRE_PRIMARY_UNKNOWN || !is_main_genre_code(pk)) {
    return null;
  }
  return {
    primary_genre: pk,
    genre_source: gp.source || 'classification-index',
    genre_confidence: gp.confidence || 'unknown',
  };
}

/**
 * @param {object} row
 * @returns {{ code: string, source: string, confidence: string, context_value: string }[]}
 */
export function tentative_emotion_tags_from_row(row) {
  const tags = row.tags || [];
  /** @type {Record<string, { context_value: string, tag_confidence: string }>} */
  const by_emotion = {};
  for (let i = 0; i < tags.length; i += 1) {
    const t = tags[i];
    if (t.dimension !== DIMENSION_CONTEXT) {
      continue;
    }
    const mapped = TENTATIVE_CONTEXT_TO_EMOTION[t.value];
    if (!mapped) {
      continue;
    }
    if (!by_emotion[mapped]) {
      by_emotion[mapped] = {
        context_value: t.value,
        tag_confidence: t.confidence || 'unknown',
      };
    }
  }
  const out = [];
  const codes = Object.keys(by_emotion).sort();
  for (let c = 0; c < codes.length; c += 1) {
    const code = codes[c];
    const meta = by_emotion[code];
    out.push({
      code: code,
      label_zh: emotion_label_zh(code),
      source: EMOTION_SOURCE_TENTATIVE_CONTEXT,
      confidence: 'tentative',
      tag_confidence: meta.tag_confidence,
      context_value: meta.context_value,
      note_zh: '由情境標籤推得的暫定情緒參考，非已驗證聽感／歌詞情緒。',
    });
  }
  return out;
}

/**
 * @param {object} index_doc
 */
function empty_lang_genre_playlist(bucket, genre_row) {
  return {
    playlist_id: mvp_lang_genre_playlist_id(bucket, genre_row.code),
    kind: 'language_genre',
    language_bucket: bucket,
    primary_genre: genre_row.code,
    label_zh: mvp_lang_genre_playlist_label_zh(bucket, genre_row.label_zh) + '音樂',
    track_ids: [],
    track_count: 0,
    playable_count: 0,
    by_genre_confidence: { confirmed: 0, inferred: 0, unknown: 0 },
  };
}

/**
 * @param {object} catalog
 * @param {string} playlist_id
 */
export function find_mvp_playlist_in_catalog(catalog, playlist_id) {
  const lists = [
    catalog.language_genre_playlists || [],
    catalog.emotion_playlists_tentative || [],
    catalog.genre_playlists || [],
  ];
  for (let L = 0; L < lists.length; L += 1) {
    const arr = lists[L];
    for (let i = 0; i < arr.length; i += 1) {
      if (arr[i].playlist_id === playlist_id) {
        return arr[i];
      }
    }
  }
  return null;
}

export function build_mvp_playlist_catalog(index_doc, opts) {
  const tracks = (index_doc && index_doc.tracks_by_id) || {};
  const ids = Object.keys(tracks).sort();
  const removed_by_mvp = (opts && opts.human_removed_by_mvp) || human_removed_ids_by_mvp_id(opts || {});

  /** @type {Record<string, object>} */
  const lang_genre_map = {};

  /** @type {Record<string, object>} */
  const emotion_playlists = {};
  for (let e = 0; e < EMOTION_CODES.length; e += 1) {
    const code = EMOTION_CODES[e];
    emotion_playlists[code] = {
      playlist_id: 'emotion:' + code,
      kind: 'emotion_tentative',
      emotion_code: code,
      label_zh: EMOTIONS_BY_CODE[code].label_zh + '（暫定參考）',
      track_ids: [],
      track_count: 0,
      playable_count: 0,
      source: EMOTION_SOURCE_TENTATIVE_CONTEXT,
    };
  }

  const seen_lang_genre = {};
  const seen_emotion = {};
  let count_unknown_or_instrumental_bucket = 0;
  let count_pure_instrumental = 0;
  let count_language_unconfirmed = 0;

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const row = tracks[id];
    if (row.cleanup_exclusion?.exclude_from_smart_playlists === true) continue;
    const playable = track_has_display_title(row);
    const lang_info = resolve_language_bucket(row);

    if (lang_info.bucket === LANG_BUCKET_UNKNOWN_INSTRUMENTAL) {
      count_unknown_or_instrumental_bucket += 1;
      if (lang_info.reason === 'special_type:純音樂') {
        count_pure_instrumental += 1;
      } else {
        count_language_unconfirmed += 1;
      }
    }

    const gm = genre_playlist_membership(row);
    if (gm) {
      const bucket = lang_info.bucket;
      const key = bucket + ':' + gm.primary_genre;
      if (!lang_genre_map[key]) {
        const mg = MAIN_GENRES.find(function (g) {
          return g.code === gm.primary_genre;
        });
        if (mg) {
          lang_genre_map[key] = empty_lang_genre_playlist(bucket, mg);
        }
      }
      const pl = lang_genre_map[key];
      const dedupe_key = key + ':' + id;
      if (pl && removed_by_mvp[pl.playlist_id] && removed_by_mvp[pl.playlist_id].has(id)) {
        /* 人工移除優先於自動分類補入，不略過後續情緒／人工 membership */
      } else if (pl && !seen_lang_genre[dedupe_key]) {
        seen_lang_genre[dedupe_key] = true;
        pl.track_ids.push(id);
        pl.track_count += 1;
        if (playable) {
          pl.playable_count += 1;
        }
        const conf = gm.genre_confidence || 'unknown';
        if (conf === 'confirmed') {
          pl.by_genre_confidence.confirmed += 1;
        } else if (conf === 'inferred') {
          pl.by_genre_confidence.inferred += 1;
        } else {
          pl.by_genre_confidence.unknown += 1;
        }
      }
    }

    const emotions = tentative_emotion_tags_from_row(row);
    for (let j = 0; j < emotions.length; j += 1) {
      const em = emotions[j];
      const pl = emotion_playlists[em.code];
      const ekey = em.code + ':' + id;
      if (pl && removed_by_mvp[pl.playlist_id] && removed_by_mvp[pl.playlist_id].has(id)) {
        continue;
      }
      if (pl && !seen_emotion[ekey]) {
        seen_emotion[ekey] = true;
        pl.track_ids.push(id);
        pl.track_count += 1;
        if (playable) {
          pl.playable_count += 1;
        }
      }
    }

    apply_manual_playlist_membership_to_maps(
      id,
      row,
      lang_genre_map,
      emotion_playlists,
      seen_lang_genre,
      seen_emotion,
      track_has_display_title(row)
    );
  }

  const lang_genre_list = Object.keys(lang_genre_map)
    .sort()
    .map(function (k) {
      return lang_genre_map[k];
    })
    .filter(function (p) {
      return p.track_count > 0;
    });

  const emotion_list = EMOTION_CODES.map(function (code) {
    return emotion_playlists[code];
  }).filter(function (p) {
    return p.track_count > 0;
  });

  return {
    schema_version: MVP_PLAYLIST_SCHEMA_VERSION,
    library_track_count: ids.length,
    language_genre_playlists: lang_genre_list,
    /** @deprecated 請改用 language_genre_playlists */
    genre_playlists: lang_genre_list,
    emotion_playlists_tentative: emotion_list,
    language_stats: {
      tracks_in_unknown_or_instrumental_bucket: count_unknown_or_instrumental_bucket,
      pure_instrumental_special_type: count_pure_instrumental,
      language_tag_unconfirmed: count_language_unconfirmed,
      note_zh:
        '語言未知／純音樂桶僅含 special 純音樂或 language 未確認；日文／韓文仍保留原始 tag，歌單合併為日韓。',
    },
    policies: {
      language_genre_zh:
        '語言（index tags）× 主曲風（genre_profile）；playlist_id 使用 ' +
        MVP_LANG_GENRE_PLAYLIST_ID_PREFIX +
        '；舊 genre: 不再產生。',
      emotion_zh:
        '僅由 context 標籤映射之暫定參考；與語言曲風獨立；非已驗證 emotion。',
      dedupe_zh: '同一歌單內以 spotify track id 去重。',
      manual_membership_zh:
        'manual-overrides 的 mvp_playlist_ids／emotion_playlist_ids 額外加入對應歌單（不取代自動 membership）。',
      legacy_playlist_id_map_zh:
        '舊 genre:{code} 對應新 lg:v2:*:{code} 僅概念對照；manifest 以新 ID 為準避免重複建立。',
    },
  };
}

/**
 * @param {object} catalog
 * @param {string} playlist_id
 * @param {object} index_doc
 */
export function preview_mvp_playlist_tracks(catalog, playlist_id, index_doc) {
  const tracks = (index_doc && index_doc.tracks_by_id) || {};
  const pl = find_mvp_playlist_in_catalog(catalog, playlist_id);
  if (!pl) {
    return { ok: false, error: 'unknown_playlist_id' };
  }
  const items = [];
  const ids = pl.track_ids || [];
  for (let k = 0; k < ids.length; k += 1) {
    const id = ids[k];
    const row = tracks[id];
    if (row.cleanup_exclusion?.exclude_from_smart_playlists === true) continue;
    if (!row) {
      continue;
    }
    items.push({
      track_id: id,
      title: row.display && row.display.name,
      artists: row.display && row.display.artists,
      genre_profile: row.genre_profile || null,
      metadata_status: row.metadata_status,
    });
  }
  return {
    ok: true,
    playlist: {
      playlist_id: pl.playlist_id,
      kind: pl.kind,
      label_zh: pl.label_zh,
      track_count: pl.track_count,
      playable_count: pl.playable_count,
    },
    tracks: items,
    local_only: true,
    not_synced_spotify: true,
  };
}

/**
 * @param {object} [opts]
 */
export function load_classification_index_for_mvp(opts) {
  const options = opts || {};
  const path = options.index_path || FILE_CLASSIFICATION_INDEX;
  if (!fs.existsSync(path)) {
    throw new Error('缺少 classification-index：' + path);
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

/**
 * @param {object} [opts]
 */
/**
 * 解析 lg:v2:{bucket}:{genre}
 * @param {string} playlist_id
 */
function parse_lang_genre_playlist_id(playlist_id) {
  if (typeof playlist_id !== 'string') {
    return null;
  }
  const prefix = MVP_LANG_GENRE_PLAYLIST_ID_PREFIX;
  if (playlist_id.indexOf(prefix) !== 0) {
    return null;
  }
  const rest = playlist_id.slice(prefix.length);
  const parts = rest.split(':');
  if (parts.length !== 2) {
    return null;
  }
  return { bucket: parts[0], primary_genre: parts[1] };
}

function ensure_lang_genre_playlist_entry(lang_genre_map, bucket, genre_code) {
  const key = bucket + ':' + genre_code;
  if (lang_genre_map[key]) {
    return lang_genre_map[key];
  }
  const mg = MAIN_GENRES.find(function (g) {
    return g.code === genre_code;
  });
  if (!mg || !is_main_genre_code(genre_code)) {
    return null;
  }
  lang_genre_map[key] = empty_lang_genre_playlist(bucket, mg);
  return lang_genre_map[key];
}

function push_track_to_lang_genre_pl(
  pl,
  track_id,
  playable,
  seen_lang_genre,
  dedupe_key,
  genre_confidence
) {
  if (!pl || seen_lang_genre[dedupe_key]) {
    return;
  }
  seen_lang_genre[dedupe_key] = true;
  pl.track_ids.push(track_id);
  pl.track_count += 1;
  if (playable) {
    pl.playable_count += 1;
  }
  const conf = genre_confidence || 'confirmed';
  if (conf === 'confirmed') {
    pl.by_genre_confidence.confirmed += 1;
  } else if (conf === 'inferred') {
    pl.by_genre_confidence.inferred += 1;
  } else {
    pl.by_genre_confidence.unknown += 1;
  }
}

/**
 * 人工指定歌單 membership（來自 classification-index.manual_playlist_membership）
 */
function apply_manual_playlist_membership_to_maps(
  track_id,
  row,
  lang_genre_map,
  emotion_playlists,
  seen_lang_genre,
  seen_emotion,
  playable
) {
  const mem = row && row.manual_playlist_membership;
  if (!mem) {
    return;
  }
  const mvp_ids = mem.mvp_playlist_ids || [];
  for (let i = 0; i < mvp_ids.length; i += 1) {
    const pid = mvp_ids[i];
    const parsed = parse_lang_genre_playlist_id(pid);
    if (!parsed) {
      continue;
    }
    const pl = ensure_lang_genre_playlist_entry(
      lang_genre_map,
      parsed.bucket,
      parsed.primary_genre
    );
    const dedupe_key = parsed.bucket + ':' + parsed.primary_genre + ':' + track_id;
    push_track_to_lang_genre_pl(
      pl,
      track_id,
      playable,
      seen_lang_genre,
      dedupe_key,
      'confirmed'
    );
  }
  const emo_ids = mem.emotion_playlist_ids || [];
  for (let e = 0; e < emo_ids.length; e += 1) {
    const eid = emo_ids[e];
    if (eid.indexOf('emotion:') !== 0) {
      continue;
    }
    const code = eid.slice('emotion:'.length);
    let pl = emotion_playlists[code];
    if (!pl && EMOTIONS_BY_CODE[code]) {
      emotion_playlists[code] = {
        playlist_id: eid,
        kind: 'emotion_tentative',
        emotion_code: code,
        label_zh: EMOTIONS_BY_CODE[code].label_zh + '（暫定參考）',
        track_ids: [],
        track_count: 0,
        playable_count: 0,
        source: EMOTION_SOURCE_MANUAL,
      };
      pl = emotion_playlists[code];
    }
    const ekey = code + ':' + track_id;
    if (pl && !seen_emotion[ekey]) {
      seen_emotion[ekey] = true;
      pl.track_ids.push(track_id);
      pl.track_count += 1;
      if (playable) {
        pl.playable_count += 1;
      }
      if (pl.source !== EMOTION_SOURCE_MANUAL) {
        pl.source = EMOTION_SOURCE_MANUAL;
      }
    }
  }
}

export function build_mvp_playlist_summary_counts(opts) {
  const index_doc = load_classification_index_for_mvp(opts);
  const catalog = build_mvp_playlist_catalog(index_doc);
  const lg = catalog.language_genre_playlists || catalog.genre_playlists || [];
  const genre_counts = lg.map(function (p) {
    return {
      playlist_id: p.playlist_id,
      label_zh: p.label_zh,
      language_bucket: p.language_bucket,
      primary_genre: p.primary_genre,
      track_count: p.track_count,
      playable_count: p.playable_count,
      by_genre_confidence: p.by_genre_confidence,
    };
  });
  const emotion_counts = catalog.emotion_playlists_tentative.map(function (p) {
    return {
      playlist_id: p.playlist_id,
      label_zh: p.label_zh,
      track_count: p.track_count,
      playable_count: p.playable_count,
      source: p.source,
    };
  });
  return {
    generated_at: new Date().toISOString(),
    library_track_count: catalog.library_track_count,
    genre_playlist_count: genre_counts.length,
    emotion_playlist_count: emotion_counts.length,
    genre_counts: genre_counts,
    emotion_counts: emotion_counts,
    catalog: catalog,
  };
}
