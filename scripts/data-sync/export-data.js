/**
 * 加密資料匯出 CLI（minimal profile）
 *
 * 用法：
 *   node scripts/data-sync/export-data.js --dry-run
 *   node scripts/data-sync/export-data.js --output "E:\transfer\spotify-organizer-minimal.zip"
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run_data_export } from '../../lib/data_sync/export_run.js';
import { clear_data_sync_test_env_for_production_cli } from '../../lib/data_sync/production_cli_guard.js';

clear_data_sync_test_env_for_production_cli();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function print_usage() {
  console.log(
    [
      'SpotifyOrganizer 資料匯出（AES-256 ZIP，minimal profile）',
      '',
      '  node scripts/data-sync/export-data.js --dry-run',
      '  node scripts/data-sync/export-data.js --output <完整路徑.zip>',
      '',
      '選項：',
      '  --dry-run           唯讀盤點，不建立 ZIP',
      '  --output <path>     加密 ZIP 輸出路徑（必填；除非 --dry-run）',
      '  --profile minimal   預設 minimal',
      '  --seven-zip <path>  手動指定 7z.exe（選用；不掃描 D 槽）',
      '',
      '7-Zip 搜尋順序（未指定 --seven-zip 時）：',
      '  PATH → Program Files\\7-Zip → Program Files (x86)\\7-Zip',
      '  或環境變數 SPOTIFY_ORGANIZER_7Z_PATH',
      '',
      '安全說明：',
      '  - 密碼由 7-Zip -p 互動輸入，不寫入命令列／.env／日誌',
      '  - ZIP AES-256 可能仍顯示檔名與目錄結構（非隱藏名稱）',
      '  - 專案內輸出請用 .data-sync-out\\ 子目錄',
    ].join('\n')
  );
}

function parse_args(argv) {
  /** @type {{ dry_run: boolean, output: string | null, profile: string, seven_zip: string | null }} */
  const out = {
    dry_run: false,
    output: null,
    profile: 'minimal',
    seven_zip: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') {
      out.dry_run = true;
    } else if (a === '--output') {
      out.output = argv[i + 1] || null;
      i += 1;
    } else if (a.indexOf('--output=') === 0) {
      out.output = a.slice('--output='.length);
    } else if (a === '--profile') {
      out.profile = argv[i + 1] || 'minimal';
      i += 1;
    } else if (a.indexOf('--profile=') === 0) {
      out.profile = a.slice('--profile='.length);
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

if (!args.dry_run && !args.output) {
  print_usage();
  console.error('\n錯誤：請以 --output 指定 ZIP 完整路徑，或改用 --dry-run。');
  process.exit(2);
}

run_data_export({
  output_zip: args.output || '',
  profile: args.profile,
  dry_run: args.dry_run,
  password_mode: 'interactive',
  seven_zip_path: args.seven_zip,
})
  .then(function (result) {
    if (result.dry_run && result.ok) {
      if (result.seven_zip) {
        console.error(
          '7-Zip：版本 ' +
            (result.seven_zip.version || '未知') +
            '｜' +
            result.seven_zip.executable +
            '｜ZIP AES-256：' +
            (result.seven_zip.aes256_zip ? '支援' : '不支援')
        );
      }
      console.log(JSON.stringify(result.inventory, null, 2));
      process.exit(0);
    }

    if (!result.ok) {
      console.error('匯出失敗：' + result.reason_zh);
      process.exit(1);
    }

    if (result.seven_zip) {
      console.error(
        '7-Zip：版本 ' +
          (result.seven_zip.version || '未知') +
          '｜' +
          result.seven_zip.executable
      );
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          output_zip: result.output_zip,
          file_count: result.file_count,
          total_bytes: result.total_bytes,
          source_git_commit: result.manifest.source_git_commit,
          seven_zip_version: result.seven_zip
            ? result.seven_zip.version
            : null,
        },
        null,
        2
      )
    );
  })
  .catch(function (err) {
    console.error('匯出失敗：' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  });
