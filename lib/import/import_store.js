/**
 * 讀寫 backup/imported/ 與合併結果（原子寫入）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { project_root } from '../config.js';
import { write_json_atomic } from '../atomic_json.js';
import { load_playlist_catalog } from './catalog.js';
import { parse_playlist_text, preview_playlist_import } from './parse_batch.js';
import { merge_backup_and_import } from './merge_library.js';

export const IMPORTED_DIR = path.join(project_root, 'backup', 'imported');

const IMPORTED_PLAYLISTS_FILE = path.join(
  IMPORTED_DIR,
  'imported-playlists.json'
);
const IMPORT_SUMMARY_FILE = path.join(IMPORTED_DIR, 'import-summary.json');

function ensure_imported_dir() {
  if (!fs.existsSync(IMPORTED_DIR)) {
    fs.mkdirSync(IMPORTED_DIR, { recursive: true });
  }
}

/**
 * @returns {object|null}
 */
export function load_imported_doc() {
  ensure_imported_dir();
  if (!fs.existsSync(IMPORTED_PLAYLISTS_FILE)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(IMPORTED_PLAYLISTS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function normalize_playlist_record(pl) {
  if (!pl.tracks) {
    pl.tracks = [];
  }
  if (!pl.batches) {
    pl.batches = [];
  }
  if (pl.user_confirmed_total === undefined) {
    pl.user_confirmed_total = null;
  }
  if (pl.user_confirmed_at === undefined) {
    pl.user_confirmed_at = null;
  }
  if (pl.import_marked_complete === undefined) {
    pl.import_marked_complete = false;
  }
  for (let i = 0; i < pl.tracks.length; i += 1) {
    if (!pl.tracks[i].playability_status) {
      pl.tracks[i].playability_status = 'unknown';
    }
  }
  return pl;
}

/**
 * @param {object} doc
 */
function save_imported_doc(doc) {
  ensure_imported_dir();
  write_json_atomic(IMPORTED_PLAYLISTS_FILE, doc);
}

function get_or_create_playlist(doc, playlist_id, playlist_name) {
  if (!doc.playlists) {
    doc.playlists = [];
  }
  for (let i = 0; i < doc.playlists.length; i += 1) {
    if (doc.playlists[i].playlist_id === playlist_id) {
      return normalize_playlist_record(doc.playlists[i]);
    }
  }
  const created = normalize_playlist_record({
    playlist_id,
    playlist_name,
    catalog_known: true,
    track_count: 0,
    duplicate_entries: 0,
    invalid_url_count: 0,
    invalid_lines: [],
    tracks: [],
    batches: [],
    user_confirmed_total: null,
    user_confirmed_at: null,
    import_marked_complete: false,
  });
  doc.playlists.push(created);
  return created;
}

function recompute_playlist_stats(pl) {
  pl.track_count = pl.tracks.length;
  const id_counts = {};
  for (let i = 0; i < pl.tracks.length; i += 1) {
    const id = pl.tracks[i].spotify_id;
    id_counts[id] = (id_counts[id] || 0) + 1;
  }
  let dup = 0;
  const keys = Object.keys(id_counts);
  for (let k = 0; k < keys.length; k += 1) {
    const c = id_counts[keys[k]];
    if (c > 1) {
      dup += c - 1;
    }
  }
  pl.duplicate_entries = dup;

  const all_invalid = [];
  for (let b = 0; b < pl.batches.length; b += 1) {
    const batch = pl.batches[b];
    if (batch.invalid_lines && batch.invalid_lines.length) {
      for (let j = 0; j < batch.invalid_lines.length; j += 1) {
        all_invalid.push(batch.invalid_lines[j]);
      }
    }
  }
  pl.invalid_lines = all_invalid;
  pl.invalid_url_count = all_invalid.length;

  if (
    pl.user_confirmed_total != null &&
    pl.track_count === pl.user_confirmed_total
  ) {
    pl.import_marked_complete = true;
  } else {
    pl.import_marked_complete = false;
  }
}

export function list_restricted_playlists_with_status() {
  const { catalog, by_id, user_id } = load_playlist_catalog();
  const doc = load_imported_doc();
  /** @type {Record<string, object>} */
  const imported_by_id = {};
  if (doc && Array.isArray(doc.playlists)) {
    for (let i = 0; i < doc.playlists.length; i += 1) {
      const p = doc.playlists[i];
      if (p && p.playlist_id) {
        imported_by_id[p.playlist_id] = normalize_playlist_record(p);
      }
    }
  }

  const restricted = [];
  for (let i = 0; i < catalog.length; i += 1) {
    const pl = catalog[i];
    if (
      !pl ||
      (pl.read_status !== 'restricted' && pl.ownership !== 'restricted')
    ) {
      continue;
    }
    const imp = imported_by_id[pl.id] || null;
    const imported_count = imp ? imp.track_count : 0;
    const catalog_track_hint =
      typeof pl.track_count === 'number' ? pl.track_count : null;

    restricted.push({
      playlist_id: pl.id,
      playlist_name: pl.name,
      catalog_track_hint,
      imported_count,
      invalid_url_count: imp ? imp.invalid_url_count : 0,
      duplicate_entries: imp ? imp.duplicate_entries : 0,
      unconfirmed_playability_count: imported_count,
      batch_count: imp && imp.batches ? imp.batches.length : 0,
      user_confirmed_total: imp ? imp.user_confirmed_total : null,
      import_marked_complete: imp ? imp.import_marked_complete : false,
      batches: imp ? imp.batches : [],
    });
  }

  return {
    user_id,
    restricted_playlists_total: restricted.length,
    restricted_complete_count: restricted.filter(function (p) {
      return p.import_marked_complete;
    }).length,
    playlists: restricted,
  };
}

/**
 * @param {string} playlist_id
 * @param {string} text
 */
export function preview_import_batch(playlist_id, text) {
  const { by_id } = load_playlist_catalog();
  const catalog_entry = by_id[playlist_id] || null;
  const doc = load_imported_doc();
  let start_position = 0;
  const hashes = [];
  if (doc && doc.playlists) {
    for (let i = 0; i < doc.playlists.length; i += 1) {
      const p = doc.playlists[i];
      if (p.playlist_id === playlist_id) {
        start_position = p.tracks ? p.tracks.length : 0;
        if (p.batches) {
          for (let b = 0; b < p.batches.length; b += 1) {
            if (p.batches[b].content_hash) {
              hashes.push(p.batches[b].content_hash);
            }
          }
        }
        break;
      }
    }
  }

  return preview_playlist_import(
    text,
    {
      playlist_id,
      playlist_name: catalog_entry ? catalog_entry.name : null,
      start_position,
    },
    hashes
  );
}

/**
 * @param {string} playlist_id
 * @param {string} text
 * @param {{ allow_duplicate_batch?: boolean }} options
 */
export function apply_import_batch(playlist_id, text, options) {
  const opts = options || {};
  const { catalog, user_id, by_id } = load_playlist_catalog();
  const catalog_entry = by_id[playlist_id] || null;
  if (
    !catalog_entry ||
    (catalog_entry.read_status !== 'restricted' &&
      catalog_entry.ownership !== 'restricted')
  ) {
    throw new Error('此歌單不在受限制匯入清單中。');
  }

  const preview = preview_import_batch(playlist_id, text);
  if (preview.duplicate_batch && !opts.allow_duplicate_batch) {
    return {
      ok: false,
      error: 'duplicate_batch',
      message: preview.duplicate_batch_message,
      preview,
    };
  }

  if (preview.valid_count === 0 && preview.invalid_count === 0) {
    return {
      ok: false,
      error: 'empty_batch',
      message: '沒有可匯入的有效歌曲網址。',
      preview,
    };
  }

  let doc = load_imported_doc();
  if (!doc) {
    doc = {
      schema_version: 1,
      imported_at: new Date().toISOString(),
      user_id,
      playlists: [],
    };
  }
  doc.user_id = user_id;

  const pl = get_or_create_playlist(
    doc,
    playlist_id,
    catalog_entry.name
  );
  const start_position = pl.tracks.length;
  const batch_id = crypto.randomBytes(8).toString('hex');

  const parsed = parse_playlist_text(text, {
    playlist_id,
    playlist_name: catalog_entry.name,
    start_position,
    batch_id,
  });

  for (let i = 0; i < parsed.tracks.length; i += 1) {
    pl.tracks.push(parsed.tracks[i]);
  }

  pl.batches.push({
    batch_id,
    imported_at: new Date().toISOString(),
    content_hash: parsed.content_hash,
    valid_count: parsed.valid_count,
    invalid_count: parsed.invalid_count,
    duplicate_entries: parsed.duplicate_entries,
    start_position,
    end_position: parsed.next_position - 1,
    invalid_lines: parsed.invalid_lines,
  });

  recompute_playlist_stats(pl);
  doc.imported_at = new Date().toISOString();

  save_imported_doc(doc);
  const summaries = rebuild_import_summaries_and_merge(doc, catalog);

  return {
    ok: true,
    batch_id,
    preview,
    playlist: summarize_playlist_for_api(pl, catalog_entry),
    summaries,
  };
}

/**
 * @param {string} playlist_id
 * @param {number} expected_total
 */
export function confirm_playlist_total(playlist_id, expected_total) {
  const total = Number(expected_total);
  if (!Number.isFinite(total) || total < 0 || total !== Math.floor(total)) {
    throw new Error('請輸入有效的非負整數曲數。');
  }

  const { catalog, by_id } = load_playlist_catalog();
  const catalog_entry = by_id[playlist_id];
  if (!catalog_entry) {
    throw new Error('找不到歌單。');
  }

  let doc = load_imported_doc();
  if (!doc) {
    throw new Error('尚無匯入資料。');
  }

  const pl = get_or_create_playlist(
    doc,
    playlist_id,
    catalog_entry.name
  );
  pl.user_confirmed_total = total;
  pl.user_confirmed_at = new Date().toISOString();
  recompute_playlist_stats(pl);
  doc.imported_at = new Date().toISOString();
  save_imported_doc(doc);

  const summaries = rebuild_import_summaries_and_merge(doc, catalog);
  return {
    ok: true,
    playlist: summarize_playlist_for_api(pl, catalog_entry),
    summaries,
    message:
      pl.import_marked_complete
        ? '已確認：匯入曲數與您填寫的總數一致，此歌單標記為完成。'
        : `已記錄預期 ${total} 首，目前匯入 ${pl.track_count} 首，尚未完成。`,
  };
}

function summarize_playlist_for_api(pl, catalog_entry) {
  return {
    playlist_id: pl.playlist_id,
    playlist_name: pl.playlist_name,
    catalog_track_hint:
      catalog_entry && typeof catalog_entry.track_count === 'number'
        ? catalog_entry.track_count
        : null,
    imported_count: pl.track_count,
    invalid_url_count: pl.invalid_url_count,
    duplicate_entries: pl.duplicate_entries,
    unconfirmed_playability_count: pl.track_count,
    user_confirmed_total: pl.user_confirmed_total,
    import_marked_complete: pl.import_marked_complete,
    batch_count: pl.batches.length,
  };
}

/**
 * @param {object} doc
 * @param {object[]} catalog
 */
export function rebuild_import_summaries_and_merge(doc, catalog) {
  const { user_id, by_id } = load_playlist_catalog();
  void user_id;

  const restricted_ids = [];
  for (let i = 0; i < catalog.length; i += 1) {
    const pl = catalog[i];
    if (
      pl &&
      (pl.read_status === 'restricted' || pl.ownership === 'restricted')
    ) {
      restricted_ids.push(pl.id);
    }
  }

  let total_invalid = 0;
  let total_duplicate = 0;
  let total_tracks = 0;
  const imported_restricted_complete = new Set();

  if (doc.playlists) {
    for (let i = 0; i < doc.playlists.length; i += 1) {
      const p = normalize_playlist_record(doc.playlists[i]);
      total_invalid += p.invalid_url_count || 0;
      total_duplicate += p.duplicate_entries || 0;
      total_tracks += p.track_count || 0;
      if (
        p.track_count > 0 &&
        restricted_ids.indexOf(p.playlist_id) >= 0 &&
        p.import_marked_complete
      ) {
        imported_restricted_complete.add(p.playlist_id);
      }
    }
  }

  /** @type {object[]} */
  const unimported_restricted = [];
  /** @type {object[]} */
  const incomplete_restricted = [];

  for (let r = 0; r < restricted_ids.length; r += 1) {
    const rid = restricted_ids[r];
    const pl = by_id[rid];
    let imp = null;
    if (doc.playlists) {
      for (let i = 0; i < doc.playlists.length; i += 1) {
        if (doc.playlists[i].playlist_id === rid) {
          imp = normalize_playlist_record(doc.playlists[i]);
          break;
        }
      }
    }
    if (!imp || imp.track_count === 0) {
      unimported_restricted.push({
        playlist_id: rid,
        playlist_name: pl && pl.name ? pl.name : null,
      });
    } else if (!imp.import_marked_complete) {
      incomplete_restricted.push({
        playlist_id: rid,
        playlist_name: pl && pl.name ? pl.name : null,
        imported_count: imp.track_count,
        user_confirmed_total: imp.user_confirmed_total,
      });
    }
  }

  const import_summary = {
    schema_version: 1,
    imported_at: doc.imported_at || new Date().toISOString(),
    import_complete:
      unimported_restricted.length === 0 &&
      incomplete_restricted.length === 0 &&
      total_invalid === 0,
    library_data_complete: false,
    counts: {
      imported_playlists_with_tracks: (doc.playlists || []).filter(function (p) {
        return p.track_count > 0;
      }).length,
      total_imported_tracks: total_tracks,
      invalid_url_lines: total_invalid,
      duplicate_track_entries: total_duplicate,
      restricted_playlists_total: restricted_ids.length,
      restricted_playlists_complete: imported_restricted_complete.size,
      restricted_playlists_incomplete: incomplete_restricted.length,
      restricted_playlists_not_started: unimported_restricted.length,
    },
    playlists: (doc.playlists || []).map(function (p) {
      return {
        playlist_id: p.playlist_id,
        playlist_name: p.playlist_name,
        track_count: p.track_count,
        duplicate_entries: p.duplicate_entries,
        invalid_url_count: p.invalid_url_count,
        import_marked_complete: p.import_marked_complete,
        user_confirmed_total: p.user_confirmed_total,
      };
    }),
    unimported_restricted_playlists: unimported_restricted,
    incomplete_restricted_playlists: incomplete_restricted,
    file_warnings: [],
  };

  write_json_atomic(IMPORT_SUMMARY_FILE, import_summary);

  const merge_summary = merge_backup_and_import({
    playlist_catalog: catalog,
    imported_doc: doc,
    unimported_restricted: unimported_restricted.concat(incomplete_restricted),
    user_id: doc.user_id,
  });

  import_summary.library_data_complete = merge_summary.library_data_complete;
  write_json_atomic(IMPORT_SUMMARY_FILE, import_summary);

  return { import_summary, merge_summary };
}
