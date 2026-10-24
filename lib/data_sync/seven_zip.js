/**
 * 7-Zip AES-256 封裝（密碼不得出現在命令列）
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ENV_ALLOW_7Z_PASSWORD_STDIN } from './constants.js';

/** @type {RegExp[]} */
const SEVEN_ZIP_REDACT = [
  /(-p)\S+/gi,
  /password\s*[:=]\s*\S+/gi,
];

/**
 * @param {string | null | undefined} text
 * @param {number} [max_len]
 */
export function sanitize_seven_zip_diagnostic(text, max_len) {
  const limit = max_len != null ? max_len : 400;
  if (!text || typeof text !== 'string') {
    return '';
  }
  let out = text.replace(/\r/g, '\n');
  for (let i = 0; i < SEVEN_ZIP_REDACT.length; i += 1) {
    out = out.replace(SEVEN_ZIP_REDACT[i], '$1[已省略]');
  }
  out = out.trim();
  if (out.length > limit) {
    out = out.slice(0, limit) + '…';
  }
  return out;
}

/**
 * 7-Zip 在 Windows 上對 7z t/l/x 無法自 pipe stdin 讀取 -p 密碼；測試模式才允許 argv -p。
 * @param {'stdin' | 'interactive' | 'seven_zip_test_argv'} pwd_mode
 * @returns {'argv' | 'pipe' | 'inherit'}
 */
export function resolve_seven_zip_password_stdio_mode(pwd_mode) {
  if (pwd_mode === 'seven_zip_test_argv') {
    return 'argv';
  }
  if (pwd_mode === 'interactive') {
    return 'inherit';
  }
  if (pwd_mode === 'stdin') {
    if (process.env[ENV_ALLOW_7Z_PASSWORD_STDIN] === '1') {
      return 'argv';
    }
    if (process.platform === 'win32') {
      return 'inherit';
    }
    return 'pipe';
  }
  return 'inherit';
}

export {
  resolve_seven_zip_executable,
  resolve_seven_zip_for_export,
  parse_seven_zip_version_from_help,
  seven_zip_help_supports_aes256_zip,
  seven_zip_executable_supports_aes256_zip,
  validate_manual_seven_zip_path,
  format_seven_zip_not_found_message,
} from './seven_zip_resolve.js';

/**
 * @param {object} options
 * @param {string} options.executable
 * @param {string} options.output_zip
 * @param {string} options.staging_root
 * @param {'interactive' | 'stdin'} options.password_mode
 * @param {string | null} [options.stdin_password]
 */
export function create_aes256_zip_from_staging(options) {
  /** @type {string[]} */
  const args = [
    'a',
    '-tzip',
    '-mem=AES256',
    '-p',
    options.output_zip,
    'export-manifest.json',
  ];
  const optional_roots = ['backup', 'reports', 'imports'];
  for (let i = 0; i < optional_roots.length; i += 1) {
    const sub = optional_roots[i];
    if (fs.existsSync(path.join(options.staging_root, sub))) {
      args.push(sub);
    }
  }

  if (options.password_mode === 'stdin') {
    if (process.env[ENV_ALLOW_7Z_PASSWORD_STDIN] !== '1') {
      throw new Error(
        '拒絕以 stdin 餵密碼：正式匯出請使用 7-Zip 互動式 -p'
      );
    }
    if (!options.stdin_password) {
      throw new Error('測試模式缺少 stdin_password');
    }
    const input =
      options.stdin_password + '\n' + options.stdin_password + '\n';
    const result = spawnSync(options.executable, args, {
      cwd: options.staging_root,
      input: input,
      encoding: 'utf8',
      windowsHide: true,
    });
    return interpret_spawn_result(result);
  }

  const result = spawnSync(options.executable, args, {
    cwd: options.staging_root,
    stdio: 'inherit',
    windowsHide: false,
  });
  return interpret_spawn_result(result);
}

/**
 * @param {import('node:child_process').SpawnSyncReturns<string>} result
 */
function interpret_spawn_result(result) {
  if (result.error) {
    return { ok: false, reason_zh: result.error.message };
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    return {
      ok: false,
      reason_zh: '7-Zip 封裝失敗（exit ' + result.status + '）' + (detail ? '：' + detail : ''),
    };
  }
  return { ok: true };
}

/**
 * @param {object} options
 * @param {string[]} command_args 不含密碼參數，如 ['t', zip_path]
 */
function run_seven_zip_with_password(options, command_args) {
  /** @type {string[]} */
  const args = command_args.slice();
  const pwd_mode = options.password_mode;
  const delivery = resolve_seven_zip_password_stdio_mode(pwd_mode);

  if (delivery === 'argv') {
    if (process.env[ENV_ALLOW_7Z_PASSWORD_STDIN] !== '1') {
      throw new Error('拒絕測試 argv 密碼');
    }
    if (!options.stdin_password) {
      throw new Error('測試模式缺少 stdin_password');
    }
    args.splice(1, 0, '-p' + options.stdin_password);
    return spawnSync(options.executable, args, {
      encoding: 'utf8',
      windowsHide: true,
    });
  }

  args.splice(1, 0, '-p');
  if (delivery === 'pipe') {
    if (!options.stdin_password) {
      throw new Error('測試模式缺少 stdin_password');
    }
    return spawnSync(options.executable, args, {
      input: options.stdin_password + '\n',
      encoding: 'utf8',
      windowsHide: true,
    });
  }

  return spawnSync(options.executable, args, {
    stdio: 'inherit',
    windowsHide: false,
  });
}

export function verify_zip_encryption_and_list(options) {
  let pwd_mode = options.password_mode;
  if (
    pwd_mode === 'stdin' &&
    process.env[ENV_ALLOW_7Z_PASSWORD_STDIN] === '1'
  ) {
    pwd_mode = 'seven_zip_test_argv';
  }
  const run_opts = Object.assign({}, options, { password_mode: pwd_mode });

  const test_args = ['t', options.zip_path];
  const test_result = run_seven_zip_with_password(run_opts, test_args);
  if (test_result.error) {
    return { ok: false, reason_zh: test_result.error.message, entries: [] };
  }
  const test_text = (test_result.stdout || '') + (test_result.stderr || '');
  if (/Wrong password/i.test(test_text)) {
    return {
      ok: false,
      reason_zh: 'ZIP 密碼錯誤（7z t）',
      entries: [],
    };
  }
  if (test_result.status !== 0) {
    const detail = sanitize_seven_zip_diagnostic(test_text);
    return {
      ok: false,
      reason_zh:
        'ZIP 完整性測試失敗（7z t，exit ' +
        test_result.status +
        '）' +
        (detail ? '：' + detail : ''),
      entries: [],
    };
  }

  const list_args = ['l', '-slt', options.zip_path];
  const result = run_seven_zip_with_password(run_opts, list_args);

  if (result.error) {
    return { ok: false, reason_zh: result.error.message, entries: [] };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      reason_zh: '7-Zip 列表／驗證失敗（exit ' + result.status + '）',
      entries: [],
    };
  }

  const text = (result.stdout || '') + (result.stderr || '');
  if (/Wrong password/i.test(text)) {
    return {
      ok: false,
      reason_zh: 'ZIP 密碼錯誤',
      entries: [],
    };
  }
  if (text.indexOf('AES-256') < 0 && text.indexOf('WzAES') < 0) {
    return {
      ok: false,
      reason_zh: 'ZIP 未偵測到 AES-256（WzAES）加密',
      entries: [],
    };
  }

  const entries = parse_slt_paths(text);
  return { ok: true, entries: entries, raw_listing: text };
}

/**
 * @param {string} slt_text
 * @returns {{ path: string, size: number | null }[]}
 */
function parse_slt_paths(slt_text) {
  /** @type {{ path: string, size: number | null }[]} */
  const entries = [];
  const lines = slt_text.split(/\r?\n/);
  let cur_path = null;
  let cur_folder = null;
  let cur_size = null;

  function flush_file_entry() {
    if (cur_path && cur_folder === '-') {
      entries.push({
        path: cur_path.replace(/\\/g, '/'),
        size: cur_size,
      });
    }
    cur_path = null;
    cur_folder = null;
    cur_size = null;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.indexOf('Path = ') === 0) {
      flush_file_entry();
      cur_path = line.slice('Path = '.length).trim();
      continue;
    }
    if (line.indexOf('Folder = ') === 0) {
      cur_folder = line.slice('Folder = '.length).trim();
      continue;
    }
    if (line.indexOf('Size = ') === 0) {
      cur_size = parseInt(line.slice('Size = '.length).trim(), 10);
    }
  }
  flush_file_entry();
  return entries;
}

/**
 * @param {object} options
 * @param {string} options.executable
 */
export function simulate_encryption_failure(options) {
  return {
    ok: false,
    reason_zh: '7-Zip 模擬加密失敗（測試）',
  };
}
