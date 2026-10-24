/**
 * 追蹤藝人唯讀備份 CLI
 * npm run backup:artists
 */
import { get_client_id } from './lib/config.js';
import { run_with_oauth } from './lib/oauth_session.js';
import {
  run_followed_artists_backup,
  print_followed_artists_summary,
} from './lib/artists/run_backup.js';
import { FOLLOWED_ARTISTS_SCOPES } from './lib/artists/paths.js';
import { has_all_scopes } from './lib/auth/scopes.js';

async function main() {
  try {
    get_client_id();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  console.log(
    '開始追蹤藝人備份（寫入 backup/library/followed-artists*.json，不修改其他 backup 檔案）…\n'
  );

  if (!has_all_scopes(FOLLOWED_ARTISTS_SCOPES)) {
    console.log(
      '[OAuth] 需要 user-follow-read。請在瀏覽器完成重新授權（成功前不覆寫 .spotify_tokens.json）。\n'
    );
  }

  try {
    await run_with_oauth(async function () {
      const summary = await run_followed_artists_backup();
      print_followed_artists_summary(summary);
      if (!summary.followed_artists_backup_complete) {
        process.exitCode = 1;
      }
    }, FOLLOWED_ARTISTS_SCOPES);
  } catch (err) {
    console.error('\n備份中斷：', err && err.message ? err.message : err);
    process.exit(1);
  }
}

main();
