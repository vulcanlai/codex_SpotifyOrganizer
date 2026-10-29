/**
 * 資料匯入主流程
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolve_effective_project_root } from './project_root.js';
import { validate_zip_input_path } from './path_guard.js';
import { resolve_seven_zip_for_export } from './seven_zip_resolve.js';
import { verify_zip_encryption_and_list } from './wzaes_zip.js';
import { extract_zip_to_directory } from './zip_content_verify.js';
import {
  load_manifest_from_extract,
  run_full_import_extract_verification,
} from './import_verify.js';
import { build_import_preview } from './import_preview.js';
import { evaluate_import_handoff } from './import_conflict.js';
import {
  compute_bundle_id_from_manifest,
} from './bundle_id.js';
import {
  create_pre_import_backup_run_dir,
  write_pre_import_backup,
  restore_from_pre_import_backup,
} from './import_backup.js';
import {
  apply_import_files_from_extract,
  verify_applied_files_match_manifest,
} from './import_apply.js';
import {
  create_import_staging_dir,
  safe_remove_import_staging_dir,
} from './import_staging.js';
import {
  read_sync_export_state,
  read_sync_import_state,
  write_sync_import_state,
} from './sync_state.js';
import {
  validate_zip_member_paths_before_extract,
  zip_listing_matches_manifest_files,
} from './import_zip_preflight.js';
import { assert_production_export_password_mode } from './production_cli_guard.js';
import { resolve_sync_zip_password } from './sync_zip_password.js';
import {
  IMPORT_APPLY_CONFIRM_TOKEN,
  SYNC_STATE_SCHEMA_VERSION,
} from './constants.js';

/**
 * @param {object} options
 */
export async function run_data_import(options) {
  const password_mode = options.password_mode || 'env';
  try {
    assert_production_export_password_mode(password_mode);
  } catch (err) {
    return {
      ok: false,
      reason_zh: err instanceof Error ? err.message : String(err),
    };
  }

  const project_root = resolve_effective_project_root({
    project_root_override: options.project_root_override || null,
  });

  const pwd_resolved = resolve_sync_zip_password(
    project_root,
    password_mode,
    options.stdin_password || null,
    options.sync_env_project_root || null
  );
  if (!pwd_resolved.ok) {
    return { ok: false, reason_zh: pwd_resolved.reason_zh };
  }
  const zip_password = pwd_resolved.password;

  const zip_check = validate_zip_input_path(options.input_zip, project_root);
  if (!zip_check.ok) {
    return { ok: false, reason_zh: zip_check.reason_zh };
  }

  const seven_optional = resolve_seven_zip_for_export({
    manual_path: options.seven_zip_path || null,
  });

  let list_result;
  if (options.seven_zip_hooks && options.seven_zip_hooks.verify) {
    list_result = await options.seven_zip_hooks.verify({
      zip_path: zip_check.abs_zip,
      password: zip_password,
    });
  } else {
    list_result = await verify_zip_encryption_and_list({
      zip_path: zip_check.abs_zip,
      password: zip_password,
    });
  }

  if (!list_result.ok) {
    return {
      ok: false,
      reason_zh: 'ZIP 驗證失敗：' + list_result.reason_zh,
    };
  }

  const preflight = validate_zip_member_paths_before_extract(
    list_result.entries
  );
  if (!preflight.ok) {
    return {
      ok: false,
      reason_zh: 'ZIP 成員路徑不安全：' + preflight.reason_zh,
    };
  }

  /** @type {string | null} */
  let staging_root = null;
  /** @type {string | null} */
  let manifest_probe_dir = null;
  try {
    manifest_probe_dir = create_import_staging_dir(project_root);
    staging_root = create_import_staging_dir(project_root);

    const extract_manifest = await extract_zip_to_directory({
      zip_path: zip_check.abs_zip,
      output_dir: manifest_probe_dir,
      password: zip_password,
      members: ['export-manifest.json'],
    });
    if (!extract_manifest.ok) {
      return { ok: false, reason_zh: extract_manifest.reason_zh };
    }

    const loaded = load_manifest_from_extract(manifest_probe_dir);
    if (!loaded.ok) {
      return { ok: false, reason_zh: loaded.reason_zh };
    }

    const listing_match = zip_listing_matches_manifest_files(
      list_result.entries,
      loaded.manifest
    );
    if (!listing_match.ok) {
      return { ok: false, reason_zh: listing_match.reason_zh };
    }

    const extract = await extract_zip_to_directory({
      zip_path: zip_check.abs_zip,
      output_dir: staging_root,
      password: zip_password,
      manifest: loaded.manifest,
    });
    if (!extract.ok) {
      return { ok: false, reason_zh: extract.reason_zh };
    }

    const full = run_full_import_extract_verification(
      staging_root,
      loaded.manifest
    );
    if (!full.ok) {
      return { ok: false, reason_zh: full.reason_zh };
    }

    const bundle_id = compute_bundle_id_from_manifest(loaded.manifest);
    const preview = build_import_preview(project_root, loaded.manifest);
    const import_state = read_sync_import_state(project_root);
    const export_state = read_sync_export_state(project_root);
    const handoff_params = {
      manifest: loaded.manifest,
      bundle_id: bundle_id,
      import_state: import_state,
      export_state: export_state,
      file_rows: preview.file_rows,
      project_has_sync_relevant_files: preview.project_has_sync_relevant_files,
    };
    let handoff = evaluate_import_handoff(handoff_params);
    // Explicit authorization is scoped to one verified manifest, never persisted.
    const authorized_manifest = options.authorized_local_modified_manifest_sha256;
    if (authorized_manifest != null) {
      if (authorized_manifest !== loaded.manifest_sha256) {
        return { ok: false, reason_zh: '覆蓋授權的 manifest SHA-256 與指定 ZIP 不符' };
      }
      if (handoff.scenario === 'local_modified') {
        const original_handoff = handoff;
        // Recheck the handoff chain and state; only local file conflicts are waived.
        handoff = evaluate_import_handoff({ ...handoff_params, file_rows: [] });
        handoff = { ...handoff, authorized_local_modified: original_handoff };
      }
    }

    preview.conflict_or_anomaly = handoff.ok ? 0 : 1;

    const summary = {
      zip_path: zip_check.abs_zip,
      manifest_schema_version: loaded.manifest.manifest_schema_version,
      data_transfer_version: loaded.manifest.data_transfer_version,
      source_git_commit: loaded.manifest.source_git_commit,
      exported_at: loaded.manifest.exported_at,
      file_count: loaded.manifest.file_count,
      total_bytes: loaded.manifest.total_bytes,
      manifest: loaded.manifest,
      bundle_id: bundle_id,
      handoff_previous_bundle_id: loaded.manifest.handoff_previous_bundle_id,
      manifest_sha256: loaded.manifest_sha256,
      would_add: preview.would_add,
      would_overwrite: preview.would_overwrite,
      identical: preview.identical,
      conflict_or_anomaly: preview.conflict_or_anomaly,
      handoff: handoff,
      zip_backend: 'wzaes',
      seven_zip: seven_optional.ok
        ? {
            executable: seven_optional.executable,
            version: seven_optional.version,
          }
        : null,
    };

    if (options.dry_run) {
      return { ok: handoff.ok, dry_run: true, preview: summary };
    }

    if (!options.apply) {
      return {
        ok: false,
        reason_zh: '請先 --dry-run 預覽，再以 --apply --confirm=' + IMPORT_APPLY_CONFIRM_TOKEN + ' 正式匯入',
        preview: summary,
      };
    }

    if (options.confirm_token !== IMPORT_APPLY_CONFIRM_TOKEN) {
      return {
        ok: false,
        reason_zh: '缺少或錯誤的 --confirm（需明確確認，非預設 Yes）',
        preview: summary,
      };
    }

    if (!handoff.ok || handoff.allow_apply === false) {
      return {
        ok: false,
        reason_zh: handoff.reason_zh,
        preview: summary,
      };
    }

    if (handoff.scenario === 'duplicate_bundle' && preview.would_overwrite === 0 && preview.would_add === 0) {
      return {
        ok: true,
        skipped_apply: true,
        reason_zh: '重複 bundle 且檔案已一致，略過寫入',
        preview: summary,
      };
    }

    const manifest_paths = loaded.manifest.files.map(function (f) {
      return f.path;
    });
    const backup_run = create_pre_import_backup_run_dir(project_root);
    const backup = write_pre_import_backup(
      project_root,
      backup_run,
      manifest_paths
    );
    if (!backup.ok) {
      return { ok: false, reason_zh: backup.reason_zh };
    }

    const applied = apply_import_files_from_extract(
      staging_root,
      project_root,
      loaded.manifest
    );
    if (!applied.ok) {
      restore_from_pre_import_backup(
        project_root,
        backup_run,
        backup.meta
      );
      return { ok: false, reason_zh: applied.reason_zh };
    }

    const post = verify_applied_files_match_manifest(
      project_root,
      loaded.manifest
    );
    if (!post.ok) {
      restore_from_pre_import_backup(
        project_root,
        backup_run,
        backup.meta
      );
      return {
        ok: false,
        reason_zh: '匯入後驗證失敗，已嘗試還原：' + post.reason_zh,
        restore_attempted: true,
      };
    }

    /** @type {Record<string, string>} */
    const baselines = {};
    for (let i = 0; i < loaded.manifest.files.length; i += 1) {
      const f = loaded.manifest.files[i];
      baselines[f.path] = f.sha256;
    }

    write_sync_import_state(project_root, {
      schema_version: SYNC_STATE_SCHEMA_VERSION,
      last_bundle_id: bundle_id,
      last_manifest_sha256: loaded.manifest_sha256,
      imported_at: new Date().toISOString(),
      import_source_zip_basename: path.basename(zip_check.abs_zip),
      exported_at_from_manifest: loaded.manifest.exported_at,
      handoff_previous_bundle_id: loaded.manifest.handoff_previous_bundle_id,
      source_git_commit_from_manifest: loaded.manifest.source_git_commit,
      file_baselines: baselines,
    });

    return {
      ok: true,
      applied: true,
      preview: summary,
      backup_run_dir: backup_run,
      backup_verified: true,
    };
  } catch (err) {
    return {
      ok: false,
      reason_zh: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (manifest_probe_dir) {
      try {
        safe_remove_import_staging_dir(manifest_probe_dir);
      } catch {
        /* */
      }
    }
    if (staging_root) {
      try {
        safe_remove_import_staging_dir(staging_root);
      } catch {
        /* 保留供排查 */
      }
    }
  }
}
