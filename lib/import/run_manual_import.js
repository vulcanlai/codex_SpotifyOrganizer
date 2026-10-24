/**
 * 掃描 imports/*.txt，寫入 backup/imported/ 並合併至 backup/merged/
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { project_root } from '../config.js';
import { write_json_atomic } from '../atomic_json.js';
import { playlist_id_from_filename } from './parse_track_url.js';
import { parse_playlist_text } from './parse_batch.js';
import { load_playlist_catalog } from './catalog.js';
import {
  load_imported_doc,
  rebuild_import_summaries_and_merge,
} from './import_store.js';

export { load_playlist_catalog } from './catalog.js';

export const IMPORTS_DIR = path.join(project_root, 'imports');
export const IMPORTED_DIR = path.join(project_root, 'backup', 'imported');

function import_one_txt_file(file_path, playlist_id, catalog_entry) {
  const playlist_name =
    catalog_entry && catalog_entry.name ? catalog_entry.name : null;
  const text = fs.readFileSync(file_path, 'utf8');
  const batch_id = crypto.randomBytes(8).toString('hex');
  const parsed = parse_playlist_text(text, {
    playlist_id,
    playlist_name,
    start_position: 0,
    batch_id,
  });

  return {
    playlist_id,
    playlist_name,
    catalog_known: Boolean(catalog_entry),
    track_count: parsed.valid_count,
    duplicate_entries: parsed.duplicate_entries,
    invalid_url_count: parsed.invalid_count,
    invalid_lines: parsed.invalid_lines,
    tracks: parsed.tracks,
    batches: [
      {
        batch_id,
        imported_at: new Date().toISOString(),
        content_hash: parsed.content_hash,
        valid_count: parsed.valid_count,
        invalid_count: parsed.invalid_count,
        duplicate_entries: parsed.duplicate_entries,
        start_position: 0,
        end_position: parsed.valid_count > 0 ? parsed.valid_count - 1 : -1,
        invalid_lines: parsed.invalid_lines,
      },
    ],
    user_confirmed_total: null,
    user_confirmed_at: null,
    import_marked_complete: false,
  };
}

/**
 * 執行匯入（離線，以 TXT 覆寫/合併至 imported 文件內同 ID 歌單）
 */
export function run_manual_import() {
  if (!fs.existsSync(IMPORTS_DIR)) {
    fs.mkdirSync(IMPORTS_DIR, { recursive: true });
  }

  const { catalog, user_id, by_id } = load_playlist_catalog();

  let doc = load_imported_doc();
  if (!doc) {
    doc = {
      schema_version: 1,
      imported_at: new Date().toISOString(),
      user_id,
      playlists: [],
    };
  }

  const files = fs.readdirSync(IMPORTS_DIR).filter(function (name) {
    return name.toLowerCase().endsWith('.txt');
  });

  /** @type {object[]} */
  const file_warnings = [];

  for (let f = 0; f < files.length; f += 1) {
    const filename = files[f];
    const playlist_id = playlist_id_from_filename(filename);
    if (!playlist_id) {
      file_warnings.push({
        file: filename,
        message: '檔名無法解析為 Playlist ID（需為 {playlist_id}.txt）',
      });
      continue;
    }

    const catalog_entry = by_id[playlist_id] || null;
    if (!catalog_entry) {
      file_warnings.push({
        file: filename,
        playlist_id,
        message: '此 ID 不在 backup/playlists.json',
      });
    }

    const result = import_one_txt_file(
      path.join(IMPORTS_DIR, filename),
      playlist_id,
      catalog_entry
    );

    let replaced = false;
    for (let i = 0; i < doc.playlists.length; i += 1) {
      if (doc.playlists[i].playlist_id === playlist_id) {
        doc.playlists[i] = result;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      doc.playlists.push(result);
    }
  }

  doc.imported_at = new Date().toISOString();
  doc.user_id = user_id;

  write_json_atomic(
    path.join(IMPORTED_DIR, 'imported-playlists.json'),
    doc
  );

  const { import_summary, merge_summary } = rebuild_import_summaries_and_merge(
    doc,
    catalog
  );
  import_summary.file_warnings = file_warnings;
  write_json_atomic(
    path.join(IMPORTED_DIR, 'import-summary.json'),
    import_summary
  );

  return { import_summary, merge_summary };
}

export function print_import_summary(result) {
  const imp = result.import_summary;
  const merge = result.merge_summary;
  const c = imp.counts || {};

  console.log('\n========== 手動匯入摘要 ==========');
  console.log(`已匯入（含曲目）的歌單數：${c.imported_playlists_with_tracks ?? 0}`);
  console.log(`匯入歌曲總筆數：${c.total_imported_tracks ?? 0}`);
  console.log(`無效網址行數：${c.invalid_url_lines ?? 0}`);
  console.log(`重複歌曲筆數：${c.duplicate_track_entries ?? 0}`);
  console.log(
    `受限制歌單完成：${c.restricted_playlists_complete ?? 0} / ${c.restricted_playlists_total ?? 0}`
  );
  console.log(
    `合併後不重複歌曲數：${merge.counts?.unique_tracks_by_spotify_id ?? 0}`
  );
  console.log(
    `整體音樂庫資料完整：${imp.library_data_complete ? '是' : '否'}`
  );
  console.log(`匯入結果：${IMPORTED_DIR}`);
  console.log(`合併結果：${path.join(project_root, 'backup', 'merged')}`);
  console.log('==================================\n');
}
