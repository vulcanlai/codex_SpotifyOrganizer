/**
 * 音樂庫備份 CLI 入口
 * 使用方式：npm run backup
 * 需先完成 OAuth（npm start 或本指令會自動 refresh／重新授權）
 */
import { get_client_id } from './lib/config.js';
import { run_with_oauth } from './lib/oauth_session.js';
import {
  run_library_backup,
  print_backup_summary,
} from './lib/backup/run_backup.js';

async function main() {
  try {
    get_client_id();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  console.log('開始 Spotify 音樂庫備份（僅讀取，不修改 Spotify 資料）…\n');

  try {
    await run_with_oauth(async function () {
      const summary = await run_library_backup();
      print_backup_summary(summary);
      if (!summary.library_backup_complete) {
        process.exitCode = 1;
      }
    });
  } catch (err) {
    console.error('\n備份流程中斷。');
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }
}

main();
