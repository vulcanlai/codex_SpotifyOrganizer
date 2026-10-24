/**
 * 資料匯出主流程（唯讀正式資料）
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { resolve_effective_project_root } from './project_root.js';
import { validate_zip_output_path } from './path_guard.js';
import {
  collect_minimal_export_files,
  inventory_minimal_export,
} from './export_profile_minimal.js';
import { hash_file_sha256_sync } from './file_hash.js';
import { build_export_manifest } from './manifest.js';
import {
  compute_bundle_id_from_manifest,
  hash_manifest_file_sha256,
} from './bundle_id.js';
import {
  resolve_handoff_previous_bundle_id_for_export,
  write_sync_export_state,
} from './sync_state.js';
import { SYNC_STATE_SCHEMA_VERSION } from './constants.js';
import {
  create_export_staging_dir,
  materialize_staging_tree,
  safe_remove_staging_dir,
} from './staging.js';
import {
  create_aes256_zip_from_staging,
  resolve_seven_zip_for_export,
  verify_zip_encryption_and_list,
} from './seven_zip.js';
import { assert_production_export_password_mode } from './production_cli_guard.js';
import {
  verify_zip_contents_by_extract,
  verify_zip_list_sizes_match_manifest,
} from './zip_content_verify.js';

/**
 * @param {string} project_root
 * @returns {string | null}
 */
function read_git_head_commit(project_root) {
  const result = spawnSync('git', ['-C', project_root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    return null;
  }
  const hash = (result.stdout || '').trim();
  return hash || null;
}

/**
 * @param {string} project_root
 * @param {string[]} rel_files
 */
function snapshot_source_hashes(project_root, rel_files) {
  /** @type {Map<string, { size: number, sha256: string }>} */
  const map = new Map();
  for (let i = 0; i < rel_files.length; i += 1) {
    const rel = rel_files[i];
    const abs = path.join(project_root, rel.split('/').join(path.sep));
    const h = hash_file_sha256_sync(abs);
    map.set(rel, h);
  }
  return map;
}

/**
 * @param {Map<string, { size: number, sha256: string }>} before
 * @param {string} project_root
 */
function assert_sources_unchanged(before, project_root) {
  const keys = Array.from(before.keys());
  for (let i = 0; i < keys.length; i += 1) {
    const rel = keys[i];
    const abs = path.join(project_root, rel.split('/').join(path.sep));
    const now = hash_file_sha256_sync(abs);
    const prev = before.get(rel);
    if (!prev || now.sha256 !== prev.sha256 || now.size !== prev.size) {
      throw new Error('匯出期間來源檔案已變更：' + rel);
    }
  }
}

/**
 * 互動驗證用：密碼只傳入 7-Zip 子行程 stdin，不寫 log／argv
 * @returns {Promise<string>}
 */
function read_verify_password_from_tty() {
  return new Promise(function (resolve, reject) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    rl.question('請輸入 ZIP 密碼以驗證封裝（不會寫入日誌）：', function (answer) {
      rl.close();
      if (!answer) {
        reject(new Error('未輸入驗證用密碼'));
        return;
      }
      resolve(answer);
    });
  });
}

/**
 * @param {object} options
 * @param {string} options.output_zip
 * @param {string} [options.profile]
 * @param {string | null} [options.project_root_override]
 * @param {boolean} [options.dry_run]
 * @param {'interactive' | 'stdin'} [options.password_mode]
 * @param {string | null} [options.stdin_password]
 * @param {string | null} [options.seven_zip_path]
 * @param {object | null} [options.seven_zip_hooks]
 */
export async function run_data_export(options) {
  const profile = options.profile || 'minimal';
  if (profile !== 'minimal') {
    return { ok: false, reason_zh: '不支援的 profile：' + profile };
  }

  const password_mode = options.password_mode || 'interactive';
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

  let seven_zip_info = null;
  if (!options.seven_zip_hooks || !options.seven_zip_hooks.executable) {
    seven_zip_info = resolve_seven_zip_for_export({
      manual_path: options.seven_zip_path || null,
    });
    if (!seven_zip_info.ok) {
      return { ok: false, reason_zh: seven_zip_info.reason_zh };
    }
  }

  if (options.dry_run) {
    const inv = inventory_minimal_export(project_root);
    return {
      ok: true,
      dry_run: true,
      inventory: inv,
      project_root: project_root,
      seven_zip: seven_zip_info
        ? {
            executable: seven_zip_info.executable,
            version: seven_zip_info.version,
            aes256_zip: seven_zip_info.aes256_zip,
            resolved_from_zh: seven_zip_info.resolved_from_zh || '手動指定',
          }
        : null,
    };
  }

  const zip_check = validate_zip_output_path(options.output_zip, project_root);
  if (!zip_check.ok) {
    return { ok: false, reason_zh: zip_check.reason_zh };
  }
  const abs_zip = zip_check.abs_zip;

  fs.mkdirSync(path.dirname(abs_zip), { recursive: true });

  const collected = collect_minimal_export_files(project_root);
  if (collected.missing_required.length > 0) {
    return {
      ok: false,
      reason_zh:
        '缺少必要工作檔案，停止匯出：' +
        collected.missing_required.join(', '),
      missing_required: collected.missing_required,
    };
  }

  const rel_files = collected.files;
  const before_hash = snapshot_source_hashes(project_root, rel_files);

  /** @type {{ relative_path: string, abs_path: string, size: number, sha256: string }[]} */
  const entries = [];
  for (let i = 0; i < rel_files.length; i += 1) {
    const rel = rel_files[i];
    const abs = path.join(project_root, rel.split('/').join(path.sep));
    const h = before_hash.get(rel);
    if (!h) {
      return { ok: false, reason_zh: '內部錯誤：缺少 hash ' + rel };
    }
    entries.push({
      relative_path: rel,
      abs_path: abs,
      size: h.size,
      sha256: h.sha256,
    });
  }

  const handoff_previous = resolve_handoff_previous_bundle_id_for_export(
    project_root
  );
  const exported_at_iso = new Date().toISOString();
  const manifest = build_export_manifest({
    exported_at_iso: exported_at_iso,
    source_git_commit: read_git_head_commit(project_root),
    profile: profile,
    entries: entries,
    handoff_previous_bundle_id: handoff_previous,
  });
  const manifest_text = JSON.stringify(manifest, null, 2);
  const manifest_sha256 = hash_manifest_file_sha256(manifest_text);
  const bundle_id = compute_bundle_id_from_manifest(manifest);

  /** @type {string | null} */
  let staging_root = null;
  try {
    staging_root = create_export_staging_dir(project_root);
    materialize_staging_tree(
      staging_root,
      entries.map(function (e) {
        return { relative_path: e.relative_path, abs_path: e.abs_path };
      }),
      manifest
    );

    /** @type {Record<string, string>} */
    const export_baselines = {};
    for (let b = 0; b < manifest.files.length; b += 1) {
      export_baselines[manifest.files[b].path] = manifest.files[b].sha256;
    }

    assert_sources_unchanged(before_hash, project_root);

    const seven_zip =
      options.seven_zip_hooks && options.seven_zip_hooks.executable
        ? options.seven_zip_hooks.executable
        : seven_zip_info.executable;
    let pack_result;
    if (options.seven_zip_hooks && options.seven_zip_hooks.create) {
      pack_result = options.seven_zip_hooks.create({
        executable: seven_zip,
        output_zip: abs_zip,
        staging_root: staging_root,
        password_mode: password_mode,
        stdin_password: options.stdin_password || null,
      });
    } else {
      pack_result = create_aes256_zip_from_staging({
        executable: seven_zip,
        output_zip: abs_zip,
        staging_root: staging_root,
        password_mode: password_mode,
        stdin_password: options.stdin_password || null,
      });
    }

    if (!pack_result.ok) {
      if (fs.existsSync(abs_zip)) {
        try {
          fs.unlinkSync(abs_zip);
        } catch {
          /* 標記無效 */
        }
      }
      return { ok: false, reason_zh: pack_result.reason_zh };
    }

    assert_sources_unchanged(before_hash, project_root);

    if (!fs.existsSync(abs_zip)) {
      return { ok: false, reason_zh: 'ZIP 未產生' };
    }

    let verify_password = options.stdin_password || null;
    if (password_mode === 'interactive') {
      verify_password = await read_verify_password_from_tty();
    }

    let verify_result;
    if (options.seven_zip_hooks && options.seven_zip_hooks.verify) {
      verify_result = options.seven_zip_hooks.verify({
        executable: seven_zip,
        zip_path: abs_zip,
        password_mode: password_mode === 'interactive' ? 'stdin' : password_mode,
        stdin_password: verify_password,
      });
    } else {
      verify_result = verify_zip_encryption_and_list({
        executable: seven_zip,
        zip_path: abs_zip,
        password_mode: password_mode === 'interactive' ? 'stdin' : password_mode,
        stdin_password: verify_password,
      });
    }

    if (!verify_result.ok) {
      try {
        fs.unlinkSync(abs_zip);
      } catch {
        /* 無效 ZIP */
      }
      return {
        ok: false,
        reason_zh: 'ZIP 驗證失敗：' + verify_result.reason_zh,
      };
    }

    const manifest_paths = new Set(
      manifest.files.map(function (f) {
        return f.path;
      })
    );
    manifest_paths.add('export-manifest.json');

    const zip_paths = new Set(
      verify_result.entries.map(function (e) {
        return e.path.replace(/\\/g, '/');
      })
    );

    if (zip_paths.size !== manifest_paths.size) {
      try {
        fs.unlinkSync(abs_zip);
      } catch {
        /* */
      }
      return {
        ok: false,
        reason_zh:
          'ZIP 成員數與 manifest 不一致（zip=' +
          zip_paths.size +
          ' manifest=' +
          manifest_paths.size +
          '）',
      };
    }

    for (const p of manifest_paths) {
      if (!zip_paths.has(p)) {
        try {
          fs.unlinkSync(abs_zip);
        } catch {
          /* */
        }
        return {
          ok: false,
          reason_zh: 'ZIP 缺少 manifest 成員：' + p,
        };
      }
    }

    const size_check = verify_zip_list_sizes_match_manifest(
      verify_result.entries,
      manifest
    );
    if (!size_check.ok) {
      try {
        fs.unlinkSync(abs_zip);
      } catch {
        /* */
      }
      return { ok: false, reason_zh: size_check.reason_zh };
    }

    const extract_mode =
      password_mode === 'interactive' ? 'interactive' : password_mode;
    const content_check = verify_zip_contents_by_extract({
      executable: seven_zip,
      zip_path: abs_zip,
      manifest: manifest,
      password_mode: extract_mode,
      stdin_password: verify_password,
    });
    if (!content_check.ok) {
      try {
        fs.unlinkSync(abs_zip);
      } catch {
        /* */
      }
      return {
        ok: false,
        reason_zh: 'ZIP 解壓 SHA-256 驗證失敗：' + content_check.reason_zh,
      };
    }

    write_sync_export_state(project_root, {
      schema_version: SYNC_STATE_SCHEMA_VERSION,
      last_bundle_id: bundle_id,
      last_manifest_sha256: manifest_sha256,
      exported_at: exported_at_iso,
      export_output_zip_basename: path.basename(abs_zip),
      handoff_previous_bundle_id: handoff_previous,
      source_git_commit_from_manifest: manifest.source_git_commit,
      file_baselines: export_baselines,
    });

    return {
      ok: true,
      output_zip: abs_zip,
      file_count: manifest.file_count + 1,
      total_bytes: manifest.total_bytes,
      manifest: manifest,
      bundle_id: bundle_id,
      project_root: project_root,
      seven_zip: seven_zip_info
        ? {
            executable: seven_zip_info.executable,
            version: seven_zip_info.version,
            aes256_zip: seven_zip_info.aes256_zip,
          }
        : null,
    };
  } catch (err) {
    if (abs_zip && fs.existsSync(abs_zip)) {
      try {
        fs.unlinkSync(abs_zip);
      } catch {
        /* */
      }
    }
    return {
      ok: false,
      reason_zh: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (staging_root) {
      try {
        safe_remove_staging_dir(staging_root);
      } catch {
        /* 保留 staging 供調查 */
      }
    }
  }
}
