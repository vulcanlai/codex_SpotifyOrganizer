/**
 * 匯出 GUI：存檔視窗 + 既有 export 核心（互動密碼）
 */
import { clear_data_sync_test_env_for_production_cli } from '../../lib/data_sync/production_cli_guard.js';
import { pick_export_zip_save_path } from '../../lib/data_sync/win_file_dialog.js';
import { validate_zip_output_path } from '../../lib/data_sync/path_guard.js';
import { resolve_project_root_from_anchor } from '../../lib/data_sync/project_root.js';
import { run_data_export } from '../../lib/data_sync/export_run.js';
import { read_gui_pick_result_file } from '../../lib/data_sync/gui_pick_result.js';

clear_data_sync_test_env_for_production_cli();

function parse_output_arg(argv) {
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--output') {
      return argv[i + 1] || null;
    }
    if (a.indexOf('--output=') === 0) {
      return a.slice('--output='.length);
    }
    if (a === '--pick-result-file') {
      const f = argv[i + 1] || null;
      if (!f) {
        return null;
      }
      const r = read_gui_pick_result_file(f);
      if (!r.ok) {
        console.error(r.reason_zh || '無法讀取選擇結果');
        process.exit(r.cancelled ? 0 : 1);
      }
      return r.path;
    }
  }
  return null;
}

async function main() {
  let output_path = parse_output_arg(process.argv);
  if (!output_path) {
    const picked = pick_export_zip_save_path();
    if (!picked.ok) {
      if (picked.cancelled) {
        console.log('已取消，未建立 ZIP，也未更新交接狀態。');
        process.exit(0);
      }
      console.error('錯誤：無法完成檔案選擇');
      console.error(picked.reason_zh);
      process.exit(1);
    }
    output_path = picked.path;
  }

  const project_root = resolve_project_root_from_anchor();
  const check = validate_zip_output_path(output_path, project_root);
  if (!check.ok) {
    console.error('輸出路徑不安全或無法使用：' + check.reason_zh);
    console.error('請重新執行並選擇其他位置或檔名。');
    process.exit(1);
  }

  console.log('即將匯出至：' + check.abs_zip);
  console.log(
    '將使用本機 .env 的 DATA_SYNC_ZIP_PASSWORD 自動加密並驗證（密碼不會寫入日誌）。'
  );
  console.log('');

  const result = await run_data_export({
    output_zip: check.abs_zip,
    profile: 'minimal',
    password_mode: 'env',
  });

  if (!result.ok) {
    console.error('匯出失敗：' + result.reason_zh);
    process.exit(1);
  }

  console.log('');
  console.log('=== 匯出完成 ===');
  console.log('ZIP 完整路徑：' + result.output_zip);
  console.log('檔案數量：' + result.file_count);
  console.log('總大小（bytes）：' + result.total_bytes);
  if (result.bundle_id) {
    console.log('bundle_id：' + result.bundle_id);
  }
  process.exit(0);
}

main().catch(function (err) {
  console.error('匯出失敗：' + (err && err.message ? err.message : String(err)));
  process.exit(1);
});
