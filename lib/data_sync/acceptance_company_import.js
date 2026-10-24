/**
 * 模擬公司端匯入驗收主流程（僅寫入 TEMP 沙箱）
 */
import readline from 'node:readline';
import { ENV_ALLOW_PROJECT_ROOT_OVERRIDE } from './constants.js';
import { IMPORT_APPLY_CONFIRM_TOKEN } from './constants.js';
import { resolve_project_root_from_anchor } from './project_root.js';
import { validate_zip_input_path } from './path_guard.js';
import { run_data_import } from './import_run.js';
import { verify_applied_files_match_manifest } from './import_apply.js';
import {
  create_unique_acceptance_sandbox,
  remove_acceptance_sandbox_safely,
  snapshot_formal_sync_guard,
  verify_formal_sync_guard_unchanged,
} from './acceptance_sandbox.js';

/**
 * @returns {Promise<boolean>}
 */
function ask_continue_default() {
  return new Promise(function (resolve) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.question(
      '是否在沙箱執行正式匯入？請輸入 yes 繼續，其他任何輸入則取消： ',
      function (answer) {
        rl.close();
        const t = (answer || '').trim().toLowerCase();
        resolve(t === 'yes' || t === 'y');
      }
    );
  });
}

/**
 * @param {object} options
 * @param {string} options.input_zip
 * @param {string | null} [options.seven_zip_path]
 * @param {'env' | 'stdin'} [options.password_mode]
 * @param {string | null} [options.stdin_password]
 * @param {boolean} [options.skip_user_confirm]
 * @param {() => Promise<boolean>} [options.ask_continue]
 * @param {(line: string) => void} [options.log]
 * @param {boolean} [options.cleanup_on_success]
 * @param {string | null} [options.formal_guard_root] 僅測試：替代正式專案做前後比對
 */
export async function run_acceptance_company_import(options) {
  const log =
    options.log ||
    function (line) {
      console.log(line);
    };

  /** @type {'success' | 'failed' | 'cancelled'} */
  let outcome = 'failed';
  let sandbox_path = null;
  /** @type {string | null} */
  let sandbox_real = null;

  const formal_root =
    options.formal_guard_root || resolve_project_root_from_anchor();
  const formal_before = snapshot_formal_sync_guard(formal_root);

  try {
    process.env[ENV_ALLOW_PROJECT_ROOT_OVERRIDE] = '1';

    const zip_check = validate_zip_input_path(options.input_zip, formal_root);
    if (!zip_check.ok) {
      return {
        ok: false,
        outcome: 'failed',
        reason_zh: zip_check.reason_zh,
        sandbox_path: null,
      };
    }

    log('ZIP 來源：' + zip_check.abs_zip);

    const sandbox = create_unique_acceptance_sandbox(formal_root);
    sandbox_path = sandbox.sandbox_path;
    sandbox_real = sandbox.sandbox_real;
    log('沙箱目標：' + sandbox_real);

    const import_opts_base = {
      project_root_override: sandbox_real,
      sync_env_project_root: formal_root,
      input_zip: zip_check.abs_zip,
      password_mode: options.password_mode || 'env',
      stdin_password: options.stdin_password || null,
      seven_zip_path: options.seven_zip_path || null,
    };

    const dry = await run_data_import(
      Object.assign({}, import_opts_base, { dry_run: true })
    );
    if (!dry.ok || !dry.preview) {
      return {
        ok: false,
        outcome: 'failed',
        reason_zh: dry.reason_zh || 'Dry Run 失敗',
        sandbox_path: sandbox_path,
        sandbox_real: sandbox_real,
        preview: dry.preview,
      };
    }

    log(
      'Dry Run：新增 ' +
        dry.preview.would_add +
        '、覆寫 ' +
        dry.preview.would_overwrite +
        '、相同 ' +
        dry.preview.identical +
        '、衝突標記 ' +
        dry.preview.conflict_or_anomaly
    );

    if (dry.preview.handoff.scenario !== 'first_import') {
      return {
        ok: false,
        outcome: 'failed',
        reason_zh:
          'handoff 預期 first_import，實際為 ' + dry.preview.handoff.scenario,
        sandbox_path: sandbox_path,
        sandbox_real: sandbox_real,
        preview: dry.preview,
      };
    }

    if (dry.preview.conflict_or_anomaly !== 0 || !dry.preview.handoff.ok) {
      return {
        ok: false,
        outcome: 'failed',
        reason_zh: dry.preview.handoff.reason_zh || 'Dry Run 存在衝突或異常',
        sandbox_path: sandbox_path,
        sandbox_real: sandbox_real,
        preview: dry.preview,
      };
    }

    log('Dry Run 通過（first_import，無衝突）。');

    let do_apply = options.skip_user_confirm === true;
    if (!do_apply) {
      const ask = options.ask_continue || ask_continue_default;
      do_apply = await ask();
    }

    if (!do_apply) {
      outcome = 'cancelled';
      return {
        ok: false,
        outcome: 'cancelled',
        reason_zh: '使用者取消，未執行沙箱匯入',
        sandbox_path: sandbox_path,
        sandbox_real: sandbox_real,
        preview: dry.preview,
      };
    }

    const applied = await run_data_import(
      Object.assign({}, import_opts_base, {
        apply: true,
        confirm_token: IMPORT_APPLY_CONFIRM_TOKEN,
      })
    );

    if (!applied.ok || !applied.preview || !applied.preview.manifest) {
      return {
        ok: false,
        outcome: 'failed',
        reason_zh: applied.reason_zh || '沙箱匯入失敗',
        sandbox_path: sandbox_path,
        sandbox_real: sandbox_real,
        preview: dry.preview,
      };
    }

    const manifest = applied.preview.manifest;
    const post = verify_applied_files_match_manifest(sandbox_real, manifest);
    if (!post.ok) {
      return {
        ok: false,
        outcome: 'failed',
        reason_zh: post.reason_zh,
        sandbox_path: sandbox_path,
        sandbox_real: sandbox_real,
        preview: dry.preview,
      };
    }

    if (dry.preview.file_count !== manifest.file_count) {
      return {
        ok: false,
        outcome: 'failed',
        reason_zh: '匯入後檔案數與 Dry Run 不一致',
        sandbox_path: sandbox_path,
        sandbox_real: sandbox_real,
      };
    }

    if (dry.preview.total_bytes !== manifest.total_bytes) {
      return {
        ok: false,
        outcome: 'failed',
        reason_zh: '匯入後總大小與 manifest 不一致',
        sandbox_path: sandbox_path,
        sandbox_real: sandbox_real,
      };
    }

    const formal_after = verify_formal_sync_guard_unchanged(
      formal_root,
      formal_before
    );
    if (!formal_after.ok) {
      return {
        ok: false,
        outcome: 'failed',
        reason_zh: formal_after.reason_zh,
        sandbox_path: sandbox_path,
        sandbox_real: sandbox_real,
      };
    }

    outcome = 'success';
    const result = {
      ok: true,
      outcome: 'success',
      sandbox_path: sandbox_path,
      sandbox_real: sandbox_real,
      zip_path: zip_check.abs_zip,
      file_count: manifest.file_count,
      total_bytes: manifest.total_bytes,
      preview: dry.preview,
      cleanup: { ok: false, reason_zh: '尚未清理' },
    };

    if (options.cleanup_on_success !== false) {
      const removed = remove_acceptance_sandbox_safely(
        sandbox_real,
        sandbox_path
      );
      result.cleanup = removed;
      if (removed.ok) {
        result.sandbox_path = null;
        result.sandbox_real = null;
      } else {
        result.ok = false;
        result.outcome = 'failed';
        result.reason_zh =
          '驗收通過但沙箱清理失敗：' + removed.reason_zh;
      }
    }

    return result;
  } finally {
    delete process.env[ENV_ALLOW_PROJECT_ROOT_OVERRIDE];
    if (outcome !== 'success' && sandbox_real) {
      log('測試未成功完成，沙箱已保留：' + sandbox_real);
    }
  }
}
