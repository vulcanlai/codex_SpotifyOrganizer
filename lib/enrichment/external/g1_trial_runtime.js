/**
 * G1 正式試驗「執行期」檔案重設（不刪樣本、不碰真實 MusicBrainz 結果以外的資料）
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../../atomic_json.js';
import { G1_TRIAL_DIR } from './g1_path_resolve.js';
import {
  empty_progress_doc,
  empty_query_cache_doc,
  empty_verification_doc,
} from './verification_store.js';
import { load_g1_trial_sample } from './g1_sample.js';
import {
  cache_doc_has_mock_entries,
  is_g1_mock_verification_row,
} from './g1_path_resolve.js';

export function trial_runtime_paths() {
  return {
    verification: path.join(G1_TRIAL_DIR, 'verification-results.json'),
    query_cache: path.join(G1_TRIAL_DIR, 'query-cache.json'),
    progress: path.join(G1_TRIAL_DIR, 'progress.json'),
    quality_report: path.join(G1_TRIAL_DIR, 'quality-report.json'),
  };
}

/**
 * @param {object} ver_doc
 */
export function verification_doc_has_mock(ver_doc) {
  const tracks = ver_doc && ver_doc.tracks ? ver_doc.tracks : {};
  const ids = Object.keys(tracks);
  for (let i = 0; i < ids.length; i += 1) {
    if (is_g1_mock_verification_row(tracks[ids[i]])) {
      return true;
    }
  }
  return false;
}

/**
 * @param {{ backup_dir?: string, dry_run?: boolean }} [opts]
 */
export function reset_g1_trial_runtime_if_mock(opts) {
  const options = opts || {};
  const paths = trial_runtime_paths();
  const sample = load_g1_trial_sample();
  const to_backup = [];
  const actions = [];

  let mock_detected = false;
  if (fs.existsSync(paths.verification)) {
    const ver = JSON.parse(fs.readFileSync(paths.verification, 'utf8'));
    if (verification_doc_has_mock(ver)) {
      mock_detected = true;
    }
  }
  if (!mock_detected && fs.existsSync(paths.query_cache)) {
    const cache = JSON.parse(fs.readFileSync(paths.query_cache, 'utf8'));
    if (cache_doc_has_mock_entries(cache)) {
      mock_detected = true;
    }
  }

  if (!mock_detected) {
    return { reset: false, reason: 'no_mock_detected', backed_up: [] };
  }

  const runtime_files = [
    paths.verification,
    paths.query_cache,
    paths.progress,
    paths.quality_report,
  ];
  for (let i = 0; i < runtime_files.length; i += 1) {
    if (fs.existsSync(runtime_files[i])) {
      to_backup.push({ file_path: runtime_files[i] });
    }
  }

  if (options.dry_run) {
    return { reset: false, dry_run: true, would_reset: to_backup.map(function (x) {
      return x.file_path;
    }) };
  }

  let backup_dir = options.backup_dir;
  if (!backup_dir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backup_dir = path.join(G1_TRIAL_DIR, 'local_backups', 'mock-runtime-' + stamp);
  }
  fs.mkdirSync(backup_dir, { recursive: true });

  for (let i = 0; i < to_backup.length; i += 1) {
    const item = to_backup[i];
    const base = path.basename(item.file_path);
    fs.copyFileSync(item.file_path, path.join(backup_dir, base));
    actions.push('backed_up:' + base);
  }

  const manifest = {
    reason: 'npm test mock MusicBrainz 寫入正式試驗目錄，已備份後清除',
    backed_up_files: to_backup.map(function (x) {
      return path.basename(x.file_path);
    }),
    backup_dir: backup_dir,
    at: new Date().toISOString(),
  };
  write_json_atomic(path.join(backup_dir, 'backup-manifest.json'), manifest);

  const empty_ver = empty_verification_doc(sample || { sample_id: null });
  write_json_atomic(paths.verification, empty_ver);
  write_json_atomic(paths.query_cache, empty_query_cache_doc());
  const prog = empty_progress_doc();
  prog.mode = 'offline';
  write_json_atomic(paths.progress, prog);
  if (fs.existsSync(paths.quality_report)) {
    fs.unlinkSync(paths.quality_report);
    actions.push('removed:quality-report.json');
  }
  actions.push('reset:verification-results.json', 'reset:query-cache.json', 'reset:progress.json');

  return { reset: true, backup_dir: backup_dir, actions: actions };
}
