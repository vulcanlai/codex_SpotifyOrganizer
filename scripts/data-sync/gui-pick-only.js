/**
 * 階段 1：僅 Windows 檔案視窗（供 VBS 隱藏啟動，不顯示主控台）
 *
 * 用法：node gui-pick-only.js <export|import|acceptance> <result.json>
 * 結束碼：0 成功、2 使用者取消、1 錯誤
 */
import fs from 'node:fs';
import {
  pick_export_zip_save_path,
  pick_import_zip_open_path,
  run_open_file_dialog_probe,
} from '../../lib/data_sync/win_file_dialog.js';
import {
  gui_pick_trace,
  is_gui_pick_trace_enabled,
} from '../../lib/data_sync/gui_pick_trace.js';

/**
 * @param {string} result_file
 * @param {object} doc
 */
function write_pick_result(result_file, doc) {
  fs.writeFileSync(result_file, JSON.stringify(doc, null, 2), 'utf8');
}

function main() {
  const mode = (process.argv[2] || '').trim().toLowerCase();
  const result_file = process.argv[3];
  if (mode === '__launcher_ping__') {
    process.stdout.write('launcher_ping_ok\n');
    process.exit(0);
  }
  if (mode === '__pick_probe__') {
    run_pick_probe(process.argv[3], process.argv[4]);
    return;
  }
  if (!mode || !result_file) {
    process.exit(1);
  }

  if (is_gui_pick_trace_enabled()) {
    gui_pick_trace('node_pick_main_start', { mode: mode });
  }

  /** @type {{ ok: boolean, cancelled?: boolean, path?: string, reason_zh?: string, mode: string }} */
  let doc = { ok: false, mode: mode };

  try {
    let picked;
    if (mode === 'export') {
      picked = pick_export_zip_save_path({ hide_host_windows: true });
    } else if (mode === 'import') {
      picked = pick_import_zip_open_path(
        '選擇要匯入 Spotify 工作資料的加密 ZIP',
        { hide_host_windows: true }
      );
    } else if (mode === 'acceptance') {
      picked = pick_import_zip_open_path(
        '模擬公司端匯入測試：選擇加密 ZIP（不寫入正式專案）',
        { hide_host_windows: true }
      );
    } else {
      doc.reason_zh = '未知模式：' + mode;
      write_pick_result(result_file, doc);
      process.exit(1);
    }

    if (!picked.ok) {
      if (picked.cancelled) {
        doc = { ok: false, cancelled: true, mode: mode };
        write_pick_result(result_file, doc);
        process.exit(2);
      }
      doc.reason_zh = picked.reason_zh || '無法完成檔案選擇';
      write_pick_result(result_file, doc);
      process.exit(1);
    }

    doc = { ok: true, path: picked.path, mode: mode };
    write_pick_result(result_file, doc);
    if (is_gui_pick_trace_enabled()) {
      gui_pick_trace('node_pick_main_ok', { mode: mode });
    }
    process.exit(0);
  } catch (err) {
    doc.reason_zh = err instanceof Error ? err.message : String(err);
    write_pick_result(result_file, doc);
    if (is_gui_pick_trace_enabled()) {
      gui_pick_trace('node_pick_main_error', {
        mode: mode,
        message: doc.reason_zh,
      });
    }
    process.exit(1);
  }
}

/**
 * @param {string | undefined} pick_mode
 * @param {string | undefined} result_file
 */
function run_pick_probe(pick_mode, result_file) {
  const target = (pick_mode || '').trim().toLowerCase();
  if (!target || !result_file) {
    process.exit(1);
  }
  if (is_gui_pick_trace_enabled()) {
    gui_pick_trace('node_pick_probe_start', { mode: target });
  }
  /** @type {string} */
  let title = 'probe';
  if (target === 'import') {
    title = '選擇要匯入 Spotify 工作資料的加密 ZIP';
  } else if (target === 'acceptance') {
    title = '模擬公司端匯入測試：選擇加密 ZIP（不寫入正式專案）';
  } else if (target !== 'open') {
    write_pick_result(result_file, {
      ok: false,
      mode: target,
      reason_zh: 'probe 僅支援 import、acceptance 或 open',
    });
    process.exit(1);
  }
  const probe = run_open_file_dialog_probe(title);
  if (!probe.ok) {
    write_pick_result(result_file, {
      ok: false,
      mode: target,
      reason_zh: probe.reason_zh || 'probe 失敗',
    });
    if (is_gui_pick_trace_enabled()) {
      gui_pick_trace('node_pick_probe_fail', { mode: target });
    }
    process.exit(1);
  }
  write_pick_result(result_file, {
    ok: true,
    mode: target,
    probe: true,
  });
  if (is_gui_pick_trace_enabled()) {
    gui_pick_trace('node_pick_probe_ok', { mode: target });
  }
  process.exit(0);
}

main();
