/**
 * 7-Zip 路徑解析、版本與 AES-256 能力（不掃描 D 槽、不搜尋 workCase）
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ENV_SEVEN_ZIP_EXECUTABLE, FORBIDDEN_ABSOLUTE_ROOTS } from './constants.js';
import { touches_forbidden_absolute_root } from './path_guard.js';

const PATH_PROBE_NAMES = ['7z.exe', '7z'];

/**
 * @param {string} help_text
 * @returns {string | null}
 */
export function parse_seven_zip_version_from_help(help_text) {
  if (typeof help_text !== 'string') {
    return null;
  }
  const m = help_text.match(/7-Zip\s+([0-9]+(?:\.[0-9]+)*)/i);
  return m ? m[1] : null;
}

/**
 * @param {string} help_text
 */
export function seven_zip_help_supports_aes256_zip(help_text) {
  if (typeof help_text !== 'string') {
    return false;
  }
  return /AES256|AES-256/i.test(help_text);
}

/**
 * 7z i 列出加密方法；比 -h 更可靠（新版 -h 未必含 AES 字樣）
 * @param {string} executable
 */
export function probe_seven_zip_format_info(executable) {
  const result = spawnSync(executable, ['i'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return (result.stdout || '') + (result.stderr || '');
}

/**
 * @param {string} executable
 */
export function seven_zip_executable_supports_aes256_zip(executable) {
  const help_probe = probe_seven_zip_help(executable);
  if (!help_probe.ok) {
    return false;
  }
  if (seven_zip_help_supports_aes256_zip(help_probe.help_text)) {
    return true;
  }
  const formats = probe_seven_zip_format_info(executable);
  return /AES256|7zAES|WzAES/i.test(formats);
}

/**
 * @param {string} executable
 * @returns {{ ok: true, help_text: string, version: string | null } | { ok: false, reason_zh: string }}
 */
export function probe_seven_zip_help(executable) {
  const result = spawnSync(executable, ['-h'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const text = (result.stdout || '') + (result.stderr || '');
  if (result.error) {
    return { ok: false, reason_zh: result.error.message };
  }
  if (text.indexOf('7-Zip') < 0) {
    return { ok: false, reason_zh: '無法確認為 7-Zip 程式' };
  }
  return {
    ok: true,
    help_text: text,
    version: parse_seven_zip_version_from_help(text),
  };
}

/**
 * @param {string} candidate
 * @returns {{ ok: true, abs_path: string } | { ok: false, reason_zh: string }}
 */
export function validate_manual_seven_zip_path(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return { ok: false, reason_zh: '未指定 7z.exe 路徑' };
  }
  const abs = path.resolve(candidate.trim());
  if (touches_forbidden_absolute_root(abs)) {
    return {
      ok: false,
      reason_zh: '指定的 7z.exe 位於禁止路徑（workCase／vulcan-project-skills 等）',
    };
  }
  const base = path.basename(abs).toLowerCase();
  if (base !== '7z.exe' && base !== '7z') {
    return { ok: false, reason_zh: '手動路徑必須為 7z.exe（或 7z）' };
  }
  if (!fs.existsSync(abs)) {
    return { ok: false, reason_zh: '找不到指定的 7z.exe：' + abs };
  }
  return { ok: true, abs_path: abs };
}

/**
 * @returns {string[]}
 */
export function build_standard_seven_zip_paths() {
  /** @type {string[]} */
  const list = [];
  const pf = process.env.ProgramFiles;
  const pf86 = process.env['ProgramFiles(x86)'];
  if (pf) {
    list.push(path.join(pf, '7-Zip', '7z.exe'));
  }
  if (pf86) {
    list.push(path.join(pf86, '7-Zip', '7z.exe'));
  }
  return list;
}

/**
 * @param {object} [options]
 * @param {string | null} [options.manual_path]
 * @returns {string | null}
 */
export function resolve_seven_zip_executable(options) {
  const manual =
    (options && options.manual_path) ||
    process.env[ENV_SEVEN_ZIP_EXECUTABLE] ||
    null;

  if (manual) {
    const check = validate_manual_seven_zip_path(manual);
    if (!check.ok) {
      return null;
    }
    const probe = probe_seven_zip_help(check.abs_path);
    return probe.ok ? check.abs_path : null;
  }

  for (let i = 0; i < PATH_PROBE_NAMES.length; i += 1) {
    const name = PATH_PROBE_NAMES[i];
    const probe = probe_seven_zip_help(name);
    if (probe.ok) {
      return name;
    }
  }

  const standard = build_standard_seven_zip_paths();
  for (let j = 0; j < standard.length; j += 1) {
    const p = standard[j];
    if (fs.existsSync(p)) {
      const probe = probe_seven_zip_help(p);
      if (probe.ok) {
        return p;
      }
    }
  }

  return null;
}

/**
 * @param {object} [options]
 * @param {string | null} [options.manual_path]
 */
export function resolve_seven_zip_for_export(options) {
  const manual =
    (options && options.manual_path) ||
    process.env[ENV_SEVEN_ZIP_EXECUTABLE] ||
    null;

  if (manual) {
    const check = validate_manual_seven_zip_path(manual);
    if (!check.ok) {
      return { ok: false, reason_zh: check.reason_zh };
    }
    const probe = probe_seven_zip_help(check.abs_path);
    if (!probe.ok) {
      return { ok: false, reason_zh: probe.reason_zh };
    }
    const aes = seven_zip_executable_supports_aes256_zip(check.abs_path);
    if (!aes) {
      return {
        ok: false,
        reason_zh:
          '此 7-Zip 不支援 ZIP AES-256（-mem=AES256），已安全停止',
        version: probe.version,
        executable: check.abs_path,
      };
    }
    return {
      ok: true,
      executable: check.abs_path,
      version: probe.version,
      aes256_zip: true,
    };
  }

  /** @type {{ source_zh: string, path: string }[]} */
  const tried = [];

  for (let i = 0; i < PATH_PROBE_NAMES.length; i += 1) {
    const name = PATH_PROBE_NAMES[i];
    tried.push({ source_zh: 'PATH（' + name + '）', path: name });
    const probe = probe_seven_zip_help(name);
    if (probe.ok) {
      const aes = seven_zip_executable_supports_aes256_zip(name);
      if (!aes) {
        return {
          ok: false,
          reason_zh:
            'PATH 上的 7-Zip 不支援 ZIP AES-256，已安全停止（版本 ' +
            (probe.version || '?') +
            '）',
          version: probe.version,
          executable: name,
        };
      }
      return {
        ok: true,
        executable: name,
        version: probe.version,
        aes256_zip: true,
        resolved_from_zh: 'PATH',
      };
    }
  }

  const standard = build_standard_seven_zip_paths();
  for (let j = 0; j < standard.length; j += 1) {
    const p = standard[j];
    tried.push({ source_zh: '標準安裝路徑', path: p });
    if (!fs.existsSync(p)) {
      continue;
    }
    const probe = probe_seven_zip_help(p);
    if (probe.ok) {
      const aes = seven_zip_executable_supports_aes256_zip(p);
      if (!aes) {
        return {
          ok: false,
          reason_zh:
            '7-Zip（' +
            p +
            '）不支援 ZIP AES-256，已安全停止（版本 ' +
            (probe.version || '?') +
            '）',
          version: probe.version,
          executable: p,
        };
      }
      return {
        ok: true,
        executable: p,
        version: probe.version,
        aes256_zip: true,
        resolved_from_zh: '標準安裝路徑',
      };
    }
  }

  return {
    ok: false,
    reason_zh: format_seven_zip_not_found_message(),
    tried: tried,
  };
}

/** @returns {string} */
export function format_seven_zip_not_found_message() {
  return [
    '找不到可用的 7-Zip（7z.exe）。',
    '請確認已安裝 7-Zip，並符合以下其中一項：',
    '  1) 將 7-Zip 加入系統 PATH；',
    '  2) 安裝至預設位置（Program Files\\7-Zip）；',
    '  3) 手動指定：export-data.bat --seven-zip "C:\\Program Files\\7-Zip\\7z.exe"',
    '     或設定環境變數 SPOTIFY_ORGANIZER_7Z_PATH（完整路徑）。',
    '不會掃描 D 槽或其他資料夾尋找 7z.exe。',
  ].join('\n');
}

/**
 * 供測試：禁止路徑常數是否包含 workCase（不存取該目錄）
 */
export function forbidden_roots_include_workcase() {
  return FORBIDDEN_ABSOLUTE_ROOTS.some(function (p) {
    return /workcase/i.test(p);
  });
}
