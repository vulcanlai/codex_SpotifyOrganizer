/**
 * 與 run-gui-launcher.vbs 相同的路徑解析（供測試對帳）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} launcher_vbs_full_path run-gui-launcher.vbs 的絕對路徑
 */
export function resolve_gui_launcher_paths(launcher_vbs_full_path) {
  const vbs_dir = path.dirname(path.resolve(launcher_vbs_full_path));
  const project_root = path.dirname(path.dirname(vbs_dir));
  return {
    vbs_dir: vbs_dir,
    project_root: project_root,
    gui_pick_only_js: path.join(vbs_dir, 'gui-pick-only.js'),
    run_gui_phase2_bat: path.join(vbs_dir, 'run-gui-phase2.bat'),
    gui_pick_result_js: path.join(
      project_root,
      'lib',
      'data_sync',
      'gui_pick_result.js'
    ),
  };
}

/**
 * @param {string} launcher_vbs_full_path
 */
export function verify_gui_launcher_paths(launcher_vbs_full_path) {
  const p = resolve_gui_launcher_paths(launcher_vbs_full_path);
  /** @type {string[]} */
  const missing = [];
  const checks = [
    ['gui_pick_only_js', p.gui_pick_only_js],
    ['run_gui_phase2_bat', p.run_gui_phase2_bat],
    ['gui_pick_result_js', p.gui_pick_result_js],
  ];
  for (let i = 0; i < checks.length; i += 1) {
    if (!fs.existsSync(checks[i][1])) {
      missing.push(checks[i][0] + ': ' + checks[i][1]);
    }
  }
  return { ok: missing.length === 0, paths: p, missing: missing };
}

/**
 * 預設：以 repo 內建 launcher 路徑驗證
 */
export function verify_default_gui_launcher_paths() {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..'
  );
  const vbs = path.join(root, 'scripts', 'data-sync', 'run-gui-launcher.vbs');
  return verify_gui_launcher_paths(vbs);
}
