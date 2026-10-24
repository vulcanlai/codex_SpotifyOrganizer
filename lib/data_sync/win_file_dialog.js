/**
 * Windows 原生存檔／開啟對話框（PowerShell -STA + WinForms，路徑經 UTF-8 檔傳遞）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IN_PROJECT_ZIP_OUTPUT_DIR } from './constants.js';
import { resolve_project_root_from_anchor } from './project_root.js';
import {
  gui_pick_trace,
  is_gui_pick_trace_enabled,
  gui_pick_trace_file_path,
  should_skip_open_initial_directory,
} from './gui_pick_trace.js';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DATA_SYNC = path.resolve(LIB_DIR, '..', '..', 'scripts', 'data-sync');

/** @type {RegExp[]} */
const DIAGNOSTIC_REDACT_PATTERNS = [
  /password\s*[:=]\s*\S+/gi,
  /token\s*[:=]\s*\S+/gi,
  /Bearer\s+\S+/gi,
  /\.env\b/gi,
  /\.spotify_tokens\.json/gi,
];

/**
 * @param {string | null | undefined} text
 * @param {number} [max_len]
 */
export function sanitize_powershell_diagnostic(text, max_len) {
  const limit = max_len != null ? max_len : 600;
  if (!text || typeof text !== 'string') {
    return '';
  }
  let out = text.replace(/\r/g, '\n');
  for (let i = 0; i < DIAGNOSTIC_REDACT_PATTERNS.length; i += 1) {
    out = out.replace(DIAGNOSTIC_REDACT_PATTERNS[i], '[已省略]');
  }
  out = out.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f]/g, '');
  out = out.trim();
  if (out.length > limit) {
    out = out.slice(0, limit) + '…';
  }
  return out;
}

/**
 * @param {string} ps1_name
 * @param {string} result_file
 * @param {string[]} extra_args
 */
export function build_powershell_picker_argv(ps1_name, result_file, extra_args) {
  const ps1 = path.join(SCRIPTS_DATA_SYNC, ps1_name);
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-STA',
    '-File',
    ps1,
    '-ResultFile',
    result_file,
  ].concat(extra_args || []);
}

/**
 * @param {number} code
 * @param {string} diagnostic
 */
function map_ps_exit(code, diagnostic) {
  if (code === 2) {
    return { ok: false, cancelled: true, reason_zh: '使用者已取消' };
  }
  if (code !== 0) {
    let reason_zh = '無法顯示 Windows 檔案視窗';
    if (code != null && code !== undefined) {
      reason_zh += '（PowerShell 結束碼 ' + code + '）';
    }
    if (diagnostic) {
      reason_zh += '\n' + diagnostic;
    }
    return { ok: false, cancelled: false, reason_zh: reason_zh, exit_code: code };
  }
  return { ok: true };
}

/**
 * @param {number} code
 */
export function map_ps_exit_for_test(code) {
  return map_ps_exit(code, '');
}

/**
 * @param {import('node:child_process').SpawnSyncReturns<string>} run
 */
function collect_run_diagnostic(run) {
  /** @type {string[]} */
  const parts = [];
  if (run.error && run.error.message) {
    parts.push('spawn: ' + run.error.message);
  }
  const err = sanitize_powershell_diagnostic(run.stderr);
  const out = sanitize_powershell_diagnostic(run.stdout);
  if (err) {
    parts.push(err);
  }
  if (out && !err) {
    parts.push(out);
  }
  return parts.join('\n').trim();
}

/**
 * @param {string} ps1_name
 * @param {string[]} extra_args
 * @param {{ hide_host_windows?: boolean }} [opts]
 */
/**
 * @param {string[]} extra_args
 */
function append_ps_trace_file_arg(extra_args) {
  /** @type {string[]} */
  const args = extra_args ? extra_args.slice() : [];
  if (is_gui_pick_trace_enabled()) {
    args.push('-TraceFile', gui_pick_trace_file_path());
  }
  return args;
}

function run_picker_ps1(ps1_name, extra_args, opts) {
  const hide_host = opts && opts.hide_host_windows === true;
  const probe_only =
    extra_args != null && extra_args.indexOf('-OpenProbeOnly') >= 0;
  const result_file = path.join(
    os.tmpdir(),
    'so-gui-pick-' + process.pid + '-' + Date.now() + '.path'
  );
  try {
    const ps1 = path.join(SCRIPTS_DATA_SYNC, ps1_name);
    if (!fs.existsSync(ps1)) {
      return {
        ok: false,
        cancelled: false,
        reason_zh: '找不到 PowerShell 腳本：' + ps1,
      };
    }

    const ps_args = build_powershell_picker_argv(
      ps1_name,
      result_file,
      append_ps_trace_file_arg(extra_args)
    );

    gui_pick_trace('node_spawn_ps_before', {
      ps1_name: ps1_name,
      probe_only: probe_only,
      hide_host: hide_host,
    });
    const spawn_t0 = performance.now();
    const run = spawnSync('powershell.exe', ps_args, {
      encoding: 'utf8',
      windowsHide: hide_host,
      timeout: 600000,
    });
    gui_pick_trace('node_spawn_ps_after', {
      ps1_name: ps1_name,
      exit_code: run.status,
      spawn_ms: Math.round(performance.now() - spawn_t0),
    });

    const code =
      run.status != null ? run.status : run.error ? 1 : 1;
    const diagnostic = collect_run_diagnostic(run);

    const mapped = map_ps_exit(code, diagnostic);
    if (!mapped.ok) {
      return mapped;
    }

    if (probe_only && code === 0) {
      return { ok: true, probe: true };
    }

    if (!fs.existsSync(result_file)) {
      return {
        ok: false,
        cancelled: false,
        reason_zh:
          '未取得選擇的路徑' +
          (diagnostic ? '\n' + diagnostic : ''),
      };
    }

    const picked = fs.readFileSync(result_file, 'utf8').trim();
    if (!picked) {
      return { ok: false, cancelled: false, reason_zh: '選擇的路徑為空' };
    }

    return { ok: true, path: picked };
  } finally {
    try {
      if (fs.existsSync(result_file)) {
        fs.unlinkSync(result_file);
      }
    } catch {
      /* */
    }
  }
}

/**
 * 僅測試 WinForms 能否在 -STA 下初始化（不顯示視窗）
 * @param {'save' | 'open'} kind
 */
export function test_winforms_picker_init(kind) {
  const ps1 =
    kind === 'open' ? 'win-pick-open-zip.ps1' : 'win-pick-save-zip.ps1';
  const result_file = path.join(
    os.tmpdir(),
    'so-gui-init-' + process.pid + '.path'
  );
  try {
    const ps_args = build_powershell_picker_argv(ps1, result_file, [
      '-TestInitOnly',
    ]);
    const run = spawnSync('powershell.exe', ps_args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000,
    });
    const code = run.status != null ? run.status : 1;
    return {
      ok: code === 0,
      exit_code: code,
      diagnostic: collect_run_diagnostic(run),
    };
  } finally {
    try {
      if (fs.existsSync(result_file)) {
        fs.unlinkSync(result_file);
      }
    } catch {
      /* */
    }
  }
}

/**
 * 匯出／匯入 ZIP 對話框預設資料夾（專案根下 .data-sync-out）
 */
export function resolve_in_project_zip_picker_initial_directory() {
  const root = resolve_project_root_from_anchor();
  const initial = path.join(root, IN_PROJECT_ZIP_OUTPUT_DIR);
  if (!fs.existsSync(initial)) {
    try {
      fs.mkdirSync(initial, { recursive: true });
    } catch {
      /* 仍交給對話框 */
    }
  }
  return initial;
}

/**
 * @param {string} [title]
 */
export function build_import_zip_open_picker_extra_args(title) {
  const initial = resolve_in_project_zip_picker_initial_directory();
  /** @type {string[]} */
  const args = [];
  const skip_initial = should_skip_open_initial_directory();
  if (!skip_initial) {
    args.push('-InitialDirectory', initial);
  }
  if (title) {
    args.push('-Title', title);
  }
  gui_pick_trace('node_build_open_args', {
    skip_initial_dir: skip_initial,
    initial_dir: skip_initial ? '' : initial,
    initial_exists: skip_initial ? false : fs.existsSync(initial),
    title_len: title ? title.length : 0,
  });
  return args;
}

/**
 * 不呼叫 ShowDialog，只量測 Open 對話框前置步驟（需 SO_GUI_PICK_TRACE）
 * @param {string} [title]
 */
export function run_open_file_dialog_probe(title) {
  const args = build_import_zip_open_picker_extra_args(title);
  args.push('-OpenProbeOnly');
  return run_picker_ps1('win-pick-open-zip.ps1', args, {
    hide_host_windows: true,
  });
}

/**
 * 匯出存檔視窗
 */
/**
 * @param {{ hide_host_windows?: boolean }} [opts]
 */
export function pick_export_zip_save_path(opts) {
  const initial = resolve_in_project_zip_picker_initial_directory();
  return run_picker_ps1(
    'win-pick-save-zip.ps1',
    [
      '-InitialDirectory',
      initial,
      '-DialogTitle',
      '匯出 Spotify 工作資料（加密 ZIP）',
    ],
    opts
  );
}

/**
 * @param {string} [title]
 * @param {{ hide_host_windows?: boolean }} [opts]
 */
export function pick_import_zip_open_path(title, opts) {
  return run_picker_ps1(
    'win-pick-open-zip.ps1',
    build_import_zip_open_picker_extra_args(title),
    opts
  );
}
