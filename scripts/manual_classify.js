/**
 * 人工分類 CLI（預設 dry-run）
 *
 * npm run manual:classify -- preview --tracks=ID --playlists=英語民謠,深夜沉靜
 * npm run manual:classify -- apply --confirm --tracks=ID --language=英文 --primary-genre=folk
 * npm run manual:classify -- show --track=ID
 * npm run manual:classify -- revoke --track=ID --field=playlists --confirm
 */
import {
  build_manual_classify_plan,
  apply_manual_classify_plan,
  show_manual_classification,
  revoke_manual_classification,
  validate_cli_genre_language_args,
} from '../lib/classification/manual_classify/manual_classify_core.js';
import { build_classification_index } from '../lib/classification/build_index.js';

function parse_argv(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.indexOf('--') === 0) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        out[a.slice(2)] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function print_plan_zh(plan) {
  console.log('=== 人工分類預覽（dry-run）===');
  if (plan.targets && plan.targets.album_ids_requested && plan.targets.album_ids_requested.length) {
    console.log('專輯 ID：', plan.targets.album_ids_requested.join(', '));
  }
  console.log('曲目數：', plan.tracks.length);
  if (plan.blocked_reasons && plan.blocked_reasons.length) {
    console.log('阻擋原因：', plan.blocked_reasons.join('；'));
  }
  if (plan.playlist_resolution) {
    const pr = plan.playlist_resolution;
    console.log('\n--- 歌單解析 ---');
    for (let i = 0; i < (pr.resolved || []).length; i += 1) {
      const r = pr.resolved[i];
      console.log(
        '✓',
        r.query,
        '→',
        r.playlist.playlist_id,
        '(' + (r.playlist.label_zh || '') + ')'
      );
    }
    for (let j = 0; j < (pr.blocked || []).length; j += 1) {
      const b = pr.blocked[j];
      console.log('✗', b.query, b.status, b.reason_zh || '');
      if (b.matches && b.matches.length) {
        for (let m = 0; m < b.matches.length; m += 1) {
          console.log('  候選：', b.matches[m].playlist_id, b.matches[m].label_zh);
        }
      }
    }
  }
  console.log('\n--- 曲目 ---');
  for (let t = 0; t < plan.tracks.length; t += 1) {
    const row = plan.tracks[t];
    console.log(
      row.track_id,
      row.in_library ? '在曲庫' : '不在曲庫（略過套用）',
      row.changed ? '將更新' : '無變更'
    );
    if (row.conflicts.length) {
      console.log('  衝突說明：', row.conflicts.join(' '));
    }
    if (row.g3_f_registry_status === 'adopted') {
      console.log('  G3-F registry：adopted（保留原紀錄）');
    }
  }
  console.log('\n可套用：', plan.ok ? '是（需 --apply --confirm）' : '否');
  console.log(plan.note_zh);
}

function build_request_from_args(args) {
  const track_tokens = [];
  if (args.tracks) {
    track_tokens.push(String(args.tracks));
  }
  if (args.track) {
    track_tokens.push(String(args.track));
  }
  if (args.ids) {
    track_tokens.push(String(args.ids));
  }
  const album = args.album || args['album-id'] || null;
  return {
    track_tokens: track_tokens.join('\n'),
    album: album,
    playlists: args.playlists || args.playlist || '',
    language: args.language || null,
    primary_genre: args['primary-genre'] || args.primary_genre || null,
    secondary_genres: args['secondary-genres']
      ? String(args['secondary-genres']).split(',')
      : [],
    contexts: args.contexts || args.context || '',
    language_bucket: args['language-bucket'] || args.language_bucket || null,
    note_zh: args.note || args['note-zh'] || null,
  };
}

function main() {
  const args = parse_argv(process.argv.slice(2));
  const cmd = args._[0] || args.command || 'preview';
  const cli_errors = validate_cli_genre_language_args({
    language: args.language,
    primary_genre: args['primary-genre'] || args.primary_genre,
  });
  if (cli_errors.length) {
    console.error(cli_errors.join('\n'));
    process.exit(1);
  }

  if (cmd === 'show') {
    const tid = args.track || args.tracks;
    if (!tid) {
      console.error('缺少 --track=');
      process.exit(1);
    }
    const res = show_manual_classification(String(tid));
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  if (cmd === 'revoke') {
    const tid = args.track || args.tracks;
    if (!tid) {
      console.error('缺少 --track=');
      process.exit(1);
    }
    if (!args.confirm) {
      console.error('撤銷需 --confirm');
      process.exit(1);
    }
    const res = revoke_manual_classification(String(tid), {
      field: args.field || 'all',
      write: true,
    });
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  const req = build_request_from_args(args);
  const plan = build_manual_classify_plan(req);

  if (cmd === 'apply') {
    if (!args.confirm) {
      console.error('套用需 --apply --confirm（先確認上方 preview）');
      print_plan_zh(plan);
      process.exit(1);
    }
    if (!plan.ok) {
      print_plan_zh(plan);
      process.exit(1);
    }
    const applied = apply_manual_classify_plan(plan, { write: true });
    console.log('已寫入 manual-overrides：', applied.writes, '筆');
    if (applied.backup_path) {
      console.log('備份：', applied.backup_path);
    }
    if (args['rebuild-index'] !== false) {
      build_classification_index();
      console.log('已執行 classify:build');
    }
    process.exit(applied.ok ? 0 : 1);
  }

  print_plan_zh(plan);
  if (args.json) {
    console.log('\n--- JSON ---');
    console.log(JSON.stringify(plan, null, 2));
  }
  process.exit(plan.ok ? 0 : 1);
}

main();
