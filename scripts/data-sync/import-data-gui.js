/**
 * 匯入 GUI：開啟檔案視窗 + Dry Run 預覽 + 確認後 Apply
 */
import readline from 'node:readline';
import path from 'node:path';
import { clear_data_sync_test_env_for_production_cli } from '../../lib/data_sync/production_cli_guard.js';
import { pick_import_zip_open_path } from '../../lib/data_sync/win_file_dialog.js';
import { resolve_project_root_from_anchor } from '../../lib/data_sync/project_root.js';
import { run_import_gui_flow } from '../../lib/data_sync/import_gui_flow.js';
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

/**
 * @returns {Promise<boolean>}
 */
function ask_apply_confirm(prompt, expected) {
  return new Promise(function (resolve) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.question(
      prompt,
      function (answer) {
        rl.close();
        const t = (answer || '').trim().toLowerCase();
        resolve(t === expected.toLowerCase());
      }
    );
  });
}

async function main() {
  let input_zip = resolve_input_zip_from_argv(process.argv);
  if (!input_zip) {
    const picked = pick_import_zip_open_path(
      '選擇要匯入 Spotify 工作資料的加密 ZIP'
    );
    if (!picked.ok) {
      if (picked.cancelled) {
        console.log('已取消，未修改任何資料。');
        process.exit(0);
      }
      console.error('錯誤：無法完成檔案選擇');
      console.error(picked.reason_zh);
      process.exit(1);
    }
    input_zip = picked.path;
  }

  const project_root = resolve_project_root_from_anchor();
  console.log('匯入目標專案：' + project_root);
  console.log('來源 ZIP：' + input_zip);
  console.log('');

  const import_common = {
    input_zip: input_zip,
    password_mode: 'env',
    sync_env_project_root: project_root,
  };

  const applied = await run_import_gui_flow({
    import_common,
    project_root,
    ask_confirm: ask_apply_confirm,
  });
  if (applied.cancelled) {
    console.log('已取消正式匯入，專案資料未變更。');
    process.exit(0);
  }

  if (!applied.ok) {
    console.error('匯入失敗：' + (applied.reason_zh || '未知錯誤'));
    if (applied.restore_attempted) {
      console.error('已嘗試還原匯入前備份，請檢查專案資料。');
    }
    process.exit(1);
  }

  console.log('');
  console.log('=== 匯入完成 ===');
  if (applied.skipped_apply) {
    console.log('（重複 bundle，已略過寫入）');
  } else {
    console.log('已寫入工作資料並更新交接狀態。');
  }
  if (applied.preview) {
    console.log('bundle_id：' + applied.preview.bundle_id);
  }
  if (applied.backup_run_dir && applied.backup_verified) {
    console.log('匯入前備份已驗證：' + applied.backup_run_dir);
  }
  process.exit(0);
}

main().catch(function (err) {
  console.error('匯入失敗：' + (err && err.message ? err.message : String(err)));
  process.exit(1);
});
