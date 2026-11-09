/**
 * 受管理資料鏡射：ZIP 為唯一基準，刪除接收端多餘納管檔。
 * 與關係層合併、一般 --apply 整檔寫入分離；必須獨立確認旗標。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DATA_TRANSFER_MIRROR_MIN_VERSION,
  IMPORT_APPLY_CONFIRM_TOKEN,
  IMPORT_MIRROR_CONFIRM_TOKEN,
  PRE_IMPORT_BACKUP_DIR,
  SYNC_STATE_DIR,
  SYNC_STATE_SCHEMA_VERSION,
} from './constants.js';
import {
  collect_minimal_export_files,
  missing_mirror_required_files,
  should_exclude_relative_path,
} from './export_profile_minimal.js';
import {
  is_path_within_root,
  lstat_is_reparse_or_symlink,
  resolve_dir_realpath,
} from './path_guard.js';
import { normalize_and_validate_import_member_path } from './import_path_rules.js';
import {
  apply_import_files_from_extract,
  verify_applied_files_match_manifest,
} from './import_apply.js';
import {
  create_pre_import_backup_run_dir,
  write_pre_import_backup,
  restore_from_pre_import_backup,
} from './import_backup.js';
import { write_sync_import_state } from './sync_state.js';

const NEVER_TOUCH_PREFIXES = [
  '.git/',
  '.env',
  '.spotify_tokens.json',
  'node_modules/',
  PRE_IMPORT_BACKUP_DIR + '/',
  SYNC_STATE_DIR + '/',
  '.data-sync-out/',
  '.data-sync-staging/',
  '.data-sync-import-staging/',
  'backup/classification/backups/',
  'backup/classification/managed-playlists-readback/',
  'backup/classification/snapshots/',
];

/**
 * @param {string} a
 * @param {string} b
 */
export function version_at_least(actual, min) {
  const pa = String(actual || '').split('.').map(function (n) {
    return parseInt(n, 10) || 0;
  });
  const pb = String(min || '').split('.').map(function (n) {
    return parseInt(n, 10) || 0;
  });
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) {
      return true;
    }
    if (x < y) {
      return false;
    }
  }
  return true;
}

/**
 * @param {string} rel
 */
export function is_protected_non_managed_relative(rel) {
  const p = (rel || '').replace(/\\/g, '/');
  if (!p) {
    return true;
  }
  for (let i = 0; i < NEVER_TOUCH_PREFIXES.length; i += 1) {
    const pre = NEVER_TOUCH_PREFIXES[i];
    if (p === pre.replace(/\/$/, '') || p.indexOf(pre) === 0) {
      return true;
    }
  }
  if (should_exclude_relative_path(p)) {
    return true;
  }
  return false;
}

/**
 * @param {object} manifest
 */
export function validate_mirror_manifest(manifest) {
  if (!manifest || manifest.profile !== 'minimal') {
    return { ok: false, reason_zh: '鏡射只接受 minimal profile ZIP' };
  }
  if (manifest.mirror_supported !== true) {
    return {
      ok: false,
      reason_zh:
        '此 ZIP 未標示鏡射就緒（舊版或不完整）。請用目前程式重新匯出後再鏡射。',
    };
  }
  if (!version_at_least(manifest.data_transfer_version, DATA_TRANSFER_MIRROR_MIN_VERSION)) {
    return {
      ok: false,
      reason_zh:
        'ZIP 交接版本過舊（' +
        (manifest.data_transfer_version || '無') +
        '），鏡射需要 ' +
        DATA_TRANSFER_MIRROR_MIN_VERSION +
        ' 以上。請重新匯出。',
    };
  }
  if (!manifest.exported_at || !Number.isFinite(Date.parse(manifest.exported_at))) {
    return { ok: false, reason_zh: 'ZIP 缺少有效 exported_at' };
  }
  const paths = (manifest.files || []).map(function (f) {
    return f.path;
  });
  const missing = missing_mirror_required_files(paths);
  if (missing.length > 0) {
    return {
      ok: false,
      reason_zh: 'ZIP 缺少鏡射必要資料：' + missing.join(', ') + '。請重新匯出。',
    };
  }
  return { ok: true };
}

/**
 * ZIP 曲庫帳號須與本機相同（本機尚無曲庫則略過）。
 * @param {string} project_root
 * @param {string} staging_root
 */
export function assert_mirror_library_user(project_root, staging_root) {
  const rel = 'backup/merged/library-v2.json';
  const incoming_path = path.join(staging_root, rel.split('/').join(path.sep));
  if (!fs.existsSync(incoming_path)) {
    return { ok: false, reason_zh: 'ZIP 缺少 library-v2.json' };
  }
  let incoming;
  try {
    incoming = JSON.parse(fs.readFileSync(incoming_path, 'utf8'));
  } catch {
    return { ok: false, reason_zh: 'ZIP 的 library-v2.json 無法解析' };
  }
  if (!incoming || !incoming.user_id) {
    return { ok: false, reason_zh: 'ZIP 曲庫缺少 user_id，來源不可信' };
  }
  const local_path = path.join(project_root, rel.split('/').join(path.sep));
  if (!fs.existsSync(local_path)) {
    return { ok: true, user_id: incoming.user_id };
  }
  try {
    const local = JSON.parse(fs.readFileSync(local_path, 'utf8'));
    if (local && local.user_id && local.user_id !== incoming.user_id) {
      return {
        ok: false,
        reason_zh: 'ZIP 曲庫帳號與本機不同，拒絕鏡射',
      };
    }
  } catch {
    /* 本機曲庫損壞時以 ZIP 為準 */
  }
  return { ok: true, user_id: incoming.user_id };
}

/**
 * @param {object} manifest
 * @param {object | null} import_state
 * @param {object | null} export_state
 */
export function incoming_mirror_is_stale(manifest, import_state, export_state) {
  const incoming = Date.parse(manifest && manifest.exported_at);
  if (!Number.isFinite(incoming)) {
    return { stale: true, reason_zh: 'ZIP 缺少有效 exported_at，拒絕鏡射' };
  }
  /** @type {number[]} */
  const local_times = [];
  if (import_state && !import_state.corrupt && import_state.exported_at_from_manifest) {
    const t = Date.parse(import_state.exported_at_from_manifest);
    if (Number.isFinite(t)) {
      local_times.push(t);
    }
  }
  if (export_state && !export_state.corrupt && export_state.exported_at) {
    const t = Date.parse(export_state.exported_at);
    if (Number.isFinite(t)) {
      local_times.push(t);
    }
  }
  if (local_times.length === 0) {
    return { stale: false };
  }
  let local_max = local_times[0];
  for (let i = 1; i < local_times.length; i += 1) {
    if (local_times[i] > local_max) {
      local_max = local_times[i];
    }
  }
  if (incoming < local_max) {
    return {
      stale: true,
      reason_zh: 'ZIP 匯出時間早於本機上次交接資料，拒絕用較舊包鏡射。',
    };
  }
  return { stale: false };
}

/**
 * @param {string} project_root
 * @param {object} manifest
 */
export function build_mirror_preview(project_root, manifest) {
  const zip_set = new Set(
    (manifest.files || []).map(function (f) {
      return f.path;
    })
  );
  const local = collect_minimal_export_files(project_root).files;
  /** @type {string[]} */
  const would_remove = [];
  for (let i = 0; i < local.length; i += 1) {
    const rel = local[i];
    if (zip_set.has(rel)) {
      continue;
    }
    if (is_protected_non_managed_relative(rel)) {
      continue;
    }
    would_remove.push(rel);
  }
  would_remove.sort();
  return { would_remove: would_remove, local_managed_count: local.length };
}

/**
 * @param {string} project_root
 * @param {string} rel
 */
export function safe_unlink_managed_relative(project_root, rel) {
  const checked = normalize_and_validate_import_member_path(rel);
  if (!checked.ok) {
    return { ok: false, reason_zh: checked.reason_zh };
  }
  if (is_protected_non_managed_relative(checked.normalized)) {
    return { ok: false, reason_zh: '拒絕刪除非納管或受保護路徑：' + rel };
  }
  const root_real = resolve_dir_realpath(project_root);
  if (!root_real) {
    return { ok: false, reason_zh: '無法解析專案根目錄' };
  }
  const abs = path.join(project_root, checked.normalized.split('/').join(path.sep));
  if (!fs.existsSync(abs)) {
    return { ok: true, missing: true };
  }
  if (lstat_is_reparse_or_symlink(abs)) {
    return { ok: false, reason_zh: '拒絕刪除 symlink：' + rel };
  }
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return { ok: false, reason_zh: '無法解析欲刪檔案：' + rel };
  }
  if (!is_path_within_root(real, root_real)) {
    return { ok: false, reason_zh: '欲刪路徑超出專案：' + rel };
  }
  const st = fs.statSync(abs);
  if (!st.isFile()) {
    return { ok: false, reason_zh: '鏡射只刪納管檔案，略過目錄：' + rel };
  }
  fs.unlinkSync(abs);
  return { ok: true };
}

/**
 * 已通過 ZIP 驗證後的鏡射分支。
 * @param {object} ctx
 */
export async function run_verified_mirror_import(ctx) {
  const options = ctx.options || {};
  if (options.relation_plan_hash) {
    return {
      ok: false,
      reason_zh: '--mirror 與 --relation-plan-hash 不可同時使用',
      preview: ctx.summary,
    };
  }
  if (options.confirm_token === IMPORT_APPLY_CONFIRM_TOKEN && options.apply) {
    return {
      ok: false,
      reason_zh:
        '一般 --apply 不會執行鏡射。請加上 --mirror --confirm=' +
        IMPORT_MIRROR_CONFIRM_TOKEN,
      preview: ctx.summary,
    };
  }

  if (ctx.import_state && ctx.import_state.corrupt) {
    return {
      ok: false,
      reason_zh: ctx.import_state.reason_zh || '匯入交接紀錄不一致，拒絕鏡射',
      preview: ctx.summary,
    };
  }
  if (ctx.export_state && ctx.export_state.corrupt) {
    return {
      ok: false,
      reason_zh: ctx.export_state.reason_zh || '匯出交接紀錄不一致，拒絕鏡射',
      preview: ctx.summary,
    };
  }

  const ready = validate_mirror_manifest(ctx.manifest);
  if (!ready.ok) {
    return { ok: false, reason_zh: ready.reason_zh, preview: ctx.summary };
  }
  const user_check = assert_mirror_library_user(ctx.project_root, ctx.staging_root);
  if (!user_check.ok) {
    return { ok: false, reason_zh: user_check.reason_zh, preview: ctx.summary };
  }
  const stale = incoming_mirror_is_stale(
    ctx.manifest,
    ctx.import_state,
    ctx.export_state
  );
  if (stale.stale) {
    return { ok: false, reason_zh: stale.reason_zh, preview: ctx.summary };
  }

  const mirror_preview = build_mirror_preview(ctx.project_root, ctx.manifest);
  ctx.summary.mirror = {
    enabled: true,
    would_remove: mirror_preview.would_remove,
    would_remove_count: mirror_preview.would_remove.length,
    note_zh:
      '鏡射以 ZIP 受管理資料為唯一基準；列出的多餘納管檔會在確認後刪除。不影響程式碼、.env、Token、Git 與未納管檔。',
  };

  if (options.dry_run) {
    return {
      ok: true,
      dry_run: true,
      mirror: true,
      preview: ctx.summary,
    };
  }

  if (!options.apply) {
    return {
      ok: false,
      reason_zh:
        '請先 --mirror --dry-run，再以 --mirror --apply --confirm=' +
        IMPORT_MIRROR_CONFIRM_TOKEN +
        ' 正式鏡射',
      preview: ctx.summary,
    };
  }
  if (options.confirm_token !== IMPORT_MIRROR_CONFIRM_TOKEN) {
    return {
      ok: false,
      reason_zh: '缺少或錯誤的鏡射確認旗標（一般 --apply 不會變成鏡射）',
      preview: ctx.summary,
    };
  }

  const zip_paths = ctx.manifest.files.map(function (f) {
    return f.path;
  });
  const backup_paths = zip_paths.concat(mirror_preview.would_remove);
  const backup_run = create_pre_import_backup_run_dir(ctx.project_root);
  const backup = write_pre_import_backup(
    ctx.project_root,
    backup_run,
    backup_paths
  );
  if (!backup.ok) {
    return { ok: false, reason_zh: backup.reason_zh, preview: ctx.summary };
  }

  try {
    const applied = apply_import_files_from_extract(
      ctx.staging_root,
      ctx.project_root,
      ctx.manifest
    );
    if (!applied.ok) {
      restore_from_pre_import_backup(ctx.project_root, backup_run, backup.meta);
      return {
        ok: false,
        reason_zh: applied.reason_zh,
        restore_attempted: true,
        preview: ctx.summary,
      };
    }
    if (options.mirror_hooks && options.mirror_hooks.after_apply_copy) {
      options.mirror_hooks.after_apply_copy();
    }
    const post = verify_applied_files_match_manifest(
      ctx.project_root,
      ctx.manifest
    );
    if (!post.ok) {
      restore_from_pre_import_backup(ctx.project_root, backup_run, backup.meta);
      return {
        ok: false,
        reason_zh: '鏡射寫入後驗證失敗，已嘗試還原：' + post.reason_zh,
        restore_attempted: true,
        preview: ctx.summary,
      };
    }

    /** @type {string[]} */
    const removed = [];
    for (let r = 0; r < mirror_preview.would_remove.length; r += 1) {
      const rel = mirror_preview.would_remove[r];
      const del = safe_unlink_managed_relative(ctx.project_root, rel);
      if (!del.ok) {
        restore_from_pre_import_backup(ctx.project_root, backup_run, backup.meta);
        return {
          ok: false,
          reason_zh: '刪除多餘納管檔失敗，已嘗試還原：' + del.reason_zh,
          restore_attempted: true,
          preview: ctx.summary,
        };
      }
      if (!del.missing) {
        removed.push(rel);
      }
    }

    const post2 = verify_applied_files_match_manifest(
      ctx.project_root,
      ctx.manifest
    );
    if (!post2.ok) {
      restore_from_pre_import_backup(ctx.project_root, backup_run, backup.meta);
      return {
        ok: false,
        reason_zh: '刪除多餘檔後驗證失敗，已嘗試還原：' + post2.reason_zh,
        restore_attempted: true,
        preview: ctx.summary,
      };
    }

    /** @type {Record<string, string>} */
    const baselines = {};
    for (let i = 0; i < ctx.manifest.files.length; i += 1) {
      const f = ctx.manifest.files[i];
      baselines[f.path] = f.sha256;
    }
    write_sync_import_state(ctx.project_root, {
      schema_version: SYNC_STATE_SCHEMA_VERSION,
      last_bundle_id: ctx.bundle_id,
      last_manifest_sha256: ctx.manifest_sha256,
      imported_at: new Date().toISOString(),
      import_source_zip_basename: path.basename(ctx.zip_path),
      exported_at_from_manifest: ctx.manifest.exported_at,
      handoff_previous_bundle_id: ctx.manifest.handoff_previous_bundle_id,
      source_git_commit_from_manifest: ctx.manifest.source_git_commit,
      file_baselines: baselines,
      last_import_mode: 'mirror',
    });

    return {
      ok: true,
      applied: true,
      mirror: true,
      removed_count: removed.length,
      removed: removed,
      backup_run_dir: backup_run,
      backup_verified: true,
      preview: ctx.summary,
      note_zh: '已鏡射受管理資料；未修改 Spotify、未碰程式碼／.env／Token。',
    };
  } catch (err) {
    restore_from_pre_import_backup(ctx.project_root, backup_run, backup.meta);
    return {
      ok: false,
      reason_zh:
        '鏡射失敗，已嘗試還原：' +
        (err && err.message ? err.message : String(err)),
      restore_attempted: true,
      preview: ctx.summary,
    };
  }
}
