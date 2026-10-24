/**
 * 加密資料匯入 CLI
 */
import { run_data_import } from '../../lib/data_sync/import_run.js';
import { clear_data_sync_test_env_for_production_cli } from '../../lib/data_sync/production_cli_guard.js';
import { resolve_project_root_from_anchor } from '../../lib/data_sync/project_root.js';
import { IMPORT_APPLY_CONFIRM_TOKEN } from '../../lib/data_sync/constants.js';

clear_data_sync_test_env_for_production_cli();

function print_usage() {
  console.log(
    [
      'SpotifyOrganizer 資料匯入（minimal profile）',
      '',
      '  import-data.bat --input "E:\\交接\\spotify-organizer-minimal.zip" --dry-run',
      '  import-data.bat --input "…zip" --apply --confirm=' +
        IMPORT_APPLY_CONFIRM_TOKEN,
      '',
      '選項：',
      '  --input <path>      來源 ZIP（必填）',
      '  --dry-run           僅預覽，不修改正式資料',
      '  --apply             正式匯入（需 --confirm）',
      '  --confirm <token>   必填確認字串',
      '  --seven-zip <path>  手動指定 7z.exe',
    ].join('\n')
  );
}

function parse_args(argv) {
  const out = {
    input: null,
    dry_run: false,
    apply: false,
    confirm: null,
    seven_zip: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') {
      out.dry_run = true;
    } else if (a === '--apply') {
      out.apply = true;
    } else if (a === '--input') {
      out.input = argv[i + 1] || null;
      i += 1;
    } else if (a.indexOf('--input=') === 0) {
      out.input = a.slice('--input='.length);
    } else if (a === '--confirm') {
      out.confirm = argv[i + 1] || null;
      i += 1;
    } else if (a.indexOf('--confirm=') === 0) {
      out.confirm = a.slice('--confirm='.length);
    } else if (a === '--seven-zip') {
      out.seven_zip = argv[i + 1] || null;
      i += 1;
    } else if (a.indexOf('--seven-zip=') === 0) {
      out.seven_zip = a.slice('--seven-zip='.length);
    } else if (a === '--help' || a === '-h') {
      out.help = true;
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

if (args.apply && args.dry_run) {
  console.error('錯誤：--apply 與 --dry-run 不可同時使用。');
  process.exit(2);
}

if (!args.dry_run && !args.apply) {
  print_usage();
  console.error('\n錯誤：請指定 --dry-run 或 --apply。');
  process.exit(2);
}

const sync_env_root = resolve_project_root_from_anchor();
run_data_import({
  input_zip: args.input,
  dry_run: args.dry_run,
  apply: args.apply,
  confirm_token: args.confirm,
  seven_zip_path: args.seven_zip,
  password_mode: 'env',
  sync_env_project_root: sync_env_root,
})
  .then(function (result) {
    if (result.preview && result.preview.seven_zip) {
      console.error(
        '7-Zip：版本 ' +
          (result.preview.seven_zip.version || '未知') +
          '｜' +
          result.preview.seven_zip.executable
      );
    }

    if (result.dry_run) {
      console.log(JSON.stringify(result.preview, null, 2));
      process.exit(result.ok ? 0 : 1);
    }

    if (!result.ok) {
      console.error('匯入失敗：' + result.reason_zh);
      if (result.preview) {
        console.error(JSON.stringify(result.preview, null, 2));
      }
      process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  })
  .catch(function (err) {
    console.error('匯入失敗：' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  });
