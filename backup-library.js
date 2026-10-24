/**
 * 收藏專輯唯讀備份 CLI
 * npm run backup:library
 */
import { get_client_id } from './lib/config.js';
import { run_with_oauth } from './lib/oauth_session.js';
import {
  run_saved_albums_backup,
  print_library_backup_summary,
} from './lib/library/run_backup.js';

async function main() {
  try {
    get_client_id();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  console.log(
    '開始收藏專輯備份（寫入 backup/library/，不修改其他 backup 檔案）…\n'
  );

  try {
    await run_with_oauth(async function () {
      const summary = await run_saved_albums_backup();
      print_library_backup_summary(summary);
      if (!summary.library_albums_backup_complete) {
        process.exitCode = 1;
      }
    });
  } catch (err) {
    console.error('\n備份中斷：', err && err.message ? err.message : err);
    process.exit(1);
  }
}

main();
