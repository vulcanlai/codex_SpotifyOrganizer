/**
 * 模擬公司匯入 GUI：開啟 ZIP + 既有沙箱驗收流程
 */
import { clear_data_sync_test_env_for_production_cli } from '../../lib/data_sync/production_cli_guard.js';
import { pick_import_zip_open_path } from '../../lib/data_sync/win_file_dialog.js';
import { run_acceptance_company_import } from '../../lib/data_sync/acceptance_company_import.js';
import { read_gui_pick_result_file } from '../../lib/data_sync/gui_pick_result.js';

clear_data_sync_test_env_for_production_cli();

function resolve_input_zip_from_argv(argv) {
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--input') {
      return argv[i + 1] || null;
    }
    if (a.indexOf('--input=') === 0) {
      return a.slice('--input='.length);
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
  let input_zip = resolve_input_zip_from_argv(process.argv);
  if (!input_zip) {
    const picked = pick_import_zip_open_path(
      '模擬公司端匯入測試：選擇加密 ZIP（不寫入正式專案）'
    );
    if (!picked.ok) {
      if (picked.cancelled) {
        console.log('已取消，未進行沙箱測試。');
        process.exit(0);
      }
      console.error('錯誤：無法完成檔案選擇');
      console.error(picked.reason_zh);
      process.exit(1);
    }
    input_zip = picked.path;
  }

  const result = await run_acceptance_company_import({
    input_zip: input_zip,
    password_mode: 'interactive',
    cleanup_on_success: true,
  });

  if (result.outcome === 'cancelled') {
    console.log('已取消：' + result.reason_zh);
    process.exit(0);
  }
  if (!result.ok) {
    console.error('驗收失敗：' + (result.reason_zh || '未知錯誤'));
    if (result.sandbox_real) {
      console.error('沙箱保留：' + result.sandbox_real);
    }
    process.exit(1);
  }
  console.log('');
  console.log('=== 模擬公司端匯入驗收成功 ===');
  console.log('ZIP：' + result.zip_path);
  console.log(
    '已驗證檔案數 ' +
      result.file_count +
      '，總大小 ' +
      result.total_bytes +
      ' bytes'
  );
  if (result.cleanup && result.cleanup.ok) {
    console.log('沙箱已安全清除。');
  }
  process.exit(0);
}

main().catch(function (err) {
  console.error(
    '驗收異常：' + (err && err.message ? err.message : String(err))
  );
  process.exit(1);
});
