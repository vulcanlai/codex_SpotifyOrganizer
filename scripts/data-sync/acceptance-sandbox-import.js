/**
 * 模擬公司端匯入驗收 CLI（僅 TEMP 沙箱，不寫入正式 D:\SpotifyOrganizer）
 */
import { clear_data_sync_test_env_for_production_cli } from '../../lib/data_sync/production_cli_guard.js';
import { run_acceptance_company_import } from '../../lib/data_sync/acceptance_company_import.js';

clear_data_sync_test_env_for_production_cli();

function print_usage() {
  console.log(
    [
      'SpotifyOrganizer 模擬公司端匯入驗收',
      '',
      '  test-company-import.bat --input "路徑\\spotify-organizer-handoff.zip"',
      '',
      '選項：',
      '  --input <path>      正式匯出的加密 ZIP（必填，唯讀）',
      '  --seven-zip <path>  手動指定 7z.exe',
      '  --help              說明',
      '',
      '流程：建立 TEMP 沙箱 → Dry Run → 確認 → 沙箱 Apply → SHA 驗證 → 成功後清除沙箱',
      '正式專案 backup／imports／reports／交接狀態不會被寫入。',
    ].join('\n')
  );
}

function parse_args(argv) {
  const out = { input: null, seven_zip: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (a === '--input') {
      out.input = argv[i + 1] || null;
      i += 1;
    } else if (a.indexOf('--input=') === 0) {
      out.input = a.slice('--input='.length);
    } else if (a === '--seven-zip') {
      out.seven_zip = argv[i + 1] || null;
      i += 1;
    } else if (a.indexOf('--seven-zip=') === 0) {
      out.seven_zip = a.slice('--seven-zip='.length);
    }
  }
  return out;
}

const args = parse_args(process.argv.slice(2));
if (args.help) {
  print_usage();
  process.exit(0);
}

if (!args.input) {
  print_usage();
  console.error('\n錯誤：請指定 --input ZIP 路徑。');
  process.exit(2);
}

run_acceptance_company_import({
  input_zip: args.input,
  seven_zip_path: args.seven_zip,
  password_mode: 'interactive',
  cleanup_on_success: true,
})
  .then(function (result) {
    if (result.outcome === 'cancelled') {
      console.error('已取消：' + result.reason_zh);
      if (result.sandbox_real) {
        console.error('沙箱保留：' + result.sandbox_real);
      }
      process.exit(3);
    }

    if (!result.ok) {
      console.error('模擬公司端匯入驗收失敗：' + (result.reason_zh || '未知錯誤'));
      if (result.sandbox_real) {
        console.error('沙箱保留供排查：' + result.sandbox_real);
      }
      process.exit(1);
    }

    console.log('');
    console.log('模擬公司端匯入驗收成功');
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
  })
  .catch(function (err) {
    console.error(
      '模擬公司端匯入驗收異常：' +
        (err && err.message ? err.message : String(err))
    );
    process.exit(1);
  });
