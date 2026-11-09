/**
 * 受管理資料鏡射：隔離合成專案，不碰正式 backup／Spotify。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run_data_export } from '../lib/data_sync/export_run.js';
import { run_data_import } from '../lib/data_sync/import_run.js';
import {
  IMPORT_APPLY_CONFIRM_TOKEN,
  IMPORT_MIRROR_CONFIRM_TOKEN,
  DATA_TRANSFER_VERSION,
} from '../lib/data_sync/constants.js';
import {
  MIRROR_REQUIRED_RELATIVE_FILES,
  REQUIRED_RELATIVE_FILES,
} from '../lib/data_sync/export_profile_minimal.js';
import {
  validate_mirror_manifest,
  incoming_mirror_is_stale,
  is_protected_non_managed_relative,
} from '../lib/data_sync/mirror_import.js';

const TEST_PASSWORD = 'test-mirror-password-value';
const USER_ID = 'offline-sync-user';

function enable_test_env() {
  process.env.DATA_SYNC_ALLOW_PROJECT_ROOT_OVERRIDE = '1';
  process.env.DATA_SYNC_ALLOW_7Z_PASSWORD_STDIN = '1';
}

function fixture_library(extra) {
  return JSON.stringify({
    schema_version: 2,
    user_id: USER_ID,
    playlist_track_entries: [],
    liked_tracks: [],
    saved_albums: [],
    track_index_by_spotify_id: {},
    ...extra,
  });
}

function write_rel(root, rel, body) {
  const abs = path.join(root, rel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf8');
  return abs;
}

function read_rel(root, rel) {
  return fs.readFileSync(path.join(root, rel.split('/').join(path.sep)), 'utf8');
}

function exists_rel(root, rel) {
  return fs.existsSync(path.join(root, rel.split('/').join(path.sep)));
}

function make_core_project(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (let i = 0; i < REQUIRED_RELATIVE_FILES.length; i += 1) {
    const rel = REQUIRED_RELATIVE_FILES[i];
    write_rel(
      root,
      rel,
      rel === 'backup/merged/library-v2.json'
        ? fixture_library({ site: 'core' })
        : JSON.stringify({ id: rel, v: 1 })
    );
  }
  return root;
}

function make_mirror_source() {
  const root = make_core_project('so-mirror-src-');
  write_rel(root, 'backup/merged/library-v2.json', fixture_library({ site: 'company' }));
  write_rel(
    root,
    'backup/classification/full-library-inference.json',
    JSON.stringify({ schema_version: 1, source: 'company' })
  );
  write_rel(
    root,
    'backup/classification/managed-playlist-rules.json',
    JSON.stringify({
      schema_version: 1,
      playlists: { pl_company: { name: '🎵 公司規則' } },
      additional_track_index_by_id: {},
    })
  );
  write_rel(
    root,
    'backup/classification/managed-playlist-baseline.json',
    JSON.stringify({ schema_version: 1, site: 'company' })
  );
  write_rel(
    root,
    'backup/classification/managed-playlist-operations.json',
    JSON.stringify({ schema_version: 1, site: 'company' })
  );
  write_rel(
    root,
    'backup/library/cleanup-ledger.json',
    JSON.stringify({ schema_version: 1, entries: [{ id: 'protect-company' }] })
  );
  write_rel(
    root,
    'backup/classification/g3-f1-wave-100/keep-from-zip.json',
    JSON.stringify({ keep: true })
  );
  write_rel(root, 'imports/a.txt', 'from-zip');
  return root;
}

function seed_receiver_extras(root) {
  write_rel(root, 'backup/merged/library-v2.json', fixture_library({ site: 'home-old' }));
  write_rel(
    root,
    'backup/classification/managed-playlist-rules.json',
    JSON.stringify({
      schema_version: 1,
      playlists: { pl_home: { name: '🎵 家裡舊規則' } },
    })
  );
  write_rel(
    root,
    'backup/library/cleanup-ledger.json',
    JSON.stringify({ schema_version: 1, entries: [{ id: 'protect-home-old' }] })
  );
  write_rel(
    root,
    'backup/classification/g3-f99-wave-100/stale-wave.json',
    JSON.stringify({ stale: true })
  );
  write_rel(root, 'backup/enrichment/stale-cache.json', JSON.stringify({ stale: true }));
  write_rel(root, 'backup/imported/stale-import.json', JSON.stringify({ stale: true }));
  write_rel(root, '.env', 'DATA_SYNC_ZIP_PASSWORD=do-not-touch\n');
  write_rel(root, '.spotify_tokens.json', '{"access_token":"fake"}');
  write_rel(root, 'unmanaged-notes.txt', 'leave-me');
  write_rel(
    root,
    'backup/classification/managed-playlists-readback/keep.json',
    JSON.stringify({ readback: true })
  );
  write_rel(
    root,
    'backup/classification/backups/formal-keep.json',
    JSON.stringify({ formal_backup: true })
  );
  write_rel(
    root,
    'backup/classification/snapshots/snap.json',
    JSON.stringify({ snapshot: true })
  );
}

function assert_tmp_owned(dir, prefix) {
  assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
  assert.ok(path.basename(dir).startsWith(prefix));
}

function rm_owned(dir, prefix) {
  if (!dir) {
    return;
  }
  assert_tmp_owned(dir, prefix);
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (err) {
    if (err && (err.code === 'ENOTEMPTY' || err.code === 'EBUSY' || err.code === 'EPERM')) {
      return;
    }
    throw err;
  }
}

async function export_zip_from(root, zip_path) {
  return run_data_export({
    project_root_override: root,
    output_zip: zip_path,
    password_mode: 'stdin',
    stdin_password: TEST_PASSWORD,
  });
}

async function import_zip_to(target, zip_path, opts) {
  return run_data_import(
    Object.assign(
      {
        project_root_override: target,
        input_zip: zip_path,
        password_mode: 'stdin',
        stdin_password: TEST_PASSWORD,
      },
      opts || {}
    )
  );
}

test('validate_mirror_manifest 拒絕舊版與缺件', function () {
  const missing = validate_mirror_manifest({
    profile: 'minimal',
    data_transfer_version: '1.0.0',
    exported_at: new Date().toISOString(),
    files: REQUIRED_RELATIVE_FILES.map(function (p) {
      return { path: p };
    }),
  });
  assert.equal(missing.ok, false);
  assert.match(missing.reason_zh, /未標示鏡射就緒|重新匯出/);

  const old_ver = validate_mirror_manifest({
    profile: 'minimal',
    mirror_supported: true,
    data_transfer_version: '1.0.0',
    exported_at: new Date().toISOString(),
    files: MIRROR_REQUIRED_RELATIVE_FILES.map(function (p) {
      return { path: p };
    }),
  });
  assert.equal(old_ver.ok, false);
  assert.match(old_ver.reason_zh, /過舊|1\.1\.0/);

  const incomplete = validate_mirror_manifest({
    profile: 'minimal',
    mirror_supported: true,
    data_transfer_version: DATA_TRANSFER_VERSION,
    exported_at: new Date().toISOString(),
    files: REQUIRED_RELATIVE_FILES.map(function (p) {
      return { path: p };
    }),
  });
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.reason_zh, /缺少鏡射必要資料/);
});

test('較舊 exported_at 視為 stale；受保護路徑不可當多餘檔刪除', function () {
  const stale = incoming_mirror_is_stale(
    { exported_at: '2020-01-01T00:00:00.000Z' },
    { exported_at_from_manifest: '2026-11-09T00:00:00.000Z' },
    null
  );
  assert.equal(stale.stale, true);
  assert.equal(is_protected_non_managed_relative('.env'), true);
  assert.equal(is_protected_non_managed_relative('.git/config'), true);
  assert.equal(
    is_protected_non_managed_relative(
      'backup/classification/managed-playlists-readback/x.json'
    ),
    true
  );
  assert.equal(
    is_protected_non_managed_relative('backup/merged/library-v2.json'),
    false
  );
});

test('完整鏡射：還原 ZIP、刪多餘納管檔、保留未納管與人工規則', async function () {
  enable_test_env();
  const src = make_mirror_source();
  const tgt = make_core_project('so-mirror-tgt-');
  const zip_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-mirror-zip-'));
  const zip = path.join(zip_dir, 'mirror-complete.zip');
  seed_receiver_extras(tgt);
  try {
    const ex = await export_zip_from(src, zip);
    assert.equal(ex.ok, true, ex.reason_zh || '');
    assert.equal(ex.manifest.mirror_supported, true);
    assert.equal(ex.manifest.data_transfer_version, DATA_TRANSFER_VERSION);

    const blocked = await import_zip_to(tgt, zip, {
      apply: true,
      confirm_token: IMPORT_APPLY_CONFIRM_TOKEN,
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.reason_zh || '', /清理紀錄|禁止整檔/);
    assert.equal(exists_rel(tgt, 'backup/enrichment/stale-cache.json'), true);
    assert.equal(read_rel(tgt, 'unmanaged-notes.txt'), 'leave-me');

    const wrong_token = await import_zip_to(tgt, zip, {
      mirror: true,
      apply: true,
      confirm_token: IMPORT_APPLY_CONFIRM_TOKEN,
    });
    assert.equal(wrong_token.ok, false);
    assert.match(wrong_token.reason_zh || '', /一般 --apply 不會執行鏡射/);

    const combo = await import_zip_to(tgt, zip, {
      mirror: true,
      dry_run: true,
      relation_plan_hash: 'not-a-real-hash',
    });
    assert.equal(combo.ok, false);
    assert.match(combo.reason_zh || '', /不可同時使用/);

    const dry = await import_zip_to(tgt, zip, { mirror: true, dry_run: true });
    assert.equal(dry.ok, true, dry.reason_zh || '');
    assert.equal(dry.mirror, true);
    assert.ok(dry.preview.mirror.would_remove.indexOf('backup/enrichment/stale-cache.json') >= 0);
    assert.ok(
      dry.preview.mirror.would_remove.indexOf(
        'backup/classification/g3-f99-wave-100/stale-wave.json'
      ) >= 0
    );
    assert.equal(exists_rel(tgt, 'backup/enrichment/stale-cache.json'), true);

    const applied = await import_zip_to(tgt, zip, {
      mirror: true,
      apply: true,
      confirm_token: IMPORT_MIRROR_CONFIRM_TOKEN,
    });
    assert.equal(applied.ok, true, applied.reason_zh || '');
    assert.equal(applied.mirror, true);
    assert.ok(applied.removed_count >= 3);

    assert.equal(read_rel(tgt, 'backup/merged/library-v2.json'), fixture_library({ site: 'company' }));
    assert.match(read_rel(tgt, 'backup/classification/managed-playlist-rules.json'), /pl_company/);
    assert.equal(read_rel(tgt, 'backup/classification/managed-playlist-rules.json').indexOf('pl_home'), -1);
    assert.match(read_rel(tgt, 'backup/library/cleanup-ledger.json'), /protect-company/);
    assert.equal(exists_rel(tgt, 'backup/classification/g3-f1-wave-100/keep-from-zip.json'), true);
    assert.equal(exists_rel(tgt, 'backup/enrichment/stale-cache.json'), false);
    assert.equal(exists_rel(tgt, 'backup/imported/stale-import.json'), false);
    assert.equal(exists_rel(tgt, 'backup/classification/g3-f99-wave-100/stale-wave.json'), false);

    assert.equal(read_rel(tgt, '.env'), 'DATA_SYNC_ZIP_PASSWORD=do-not-touch\n');
    assert.equal(read_rel(tgt, '.spotify_tokens.json'), '{"access_token":"fake"}');
    assert.equal(read_rel(tgt, 'unmanaged-notes.txt'), 'leave-me');
    assert.equal(
      exists_rel(tgt, 'backup/classification/managed-playlists-readback/keep.json'),
      true
    );
    assert.equal(exists_rel(tgt, 'backup/classification/backups/formal-keep.json'), true);
    assert.equal(exists_rel(tgt, 'backup/classification/snapshots/snap.json'), true);

    const again = await import_zip_to(tgt, zip, {
      mirror: true,
      apply: true,
      confirm_token: IMPORT_MIRROR_CONFIRM_TOKEN,
    });
    assert.equal(again.ok, true, again.reason_zh || '');
    assert.equal(read_rel(tgt, 'backup/merged/library-v2.json'), fixture_library({ site: 'company' }));
    assert.equal(read_rel(tgt, 'unmanaged-notes.txt'), 'leave-me');
  } finally {
    rm_owned(src, 'so-mirror-src-');
    rm_owned(tgt, 'so-mirror-tgt-');
    rm_owned(zip_dir, 'so-mirror-zip-');
  }
});


test('舊 ZIP、錯誤密碼、損壞 ZIP 皆拒絕鏡射', async function () {
  enable_test_env();
  const old_src = make_core_project('so-mirror-old-');
  const complete_src = make_mirror_source();
  const tgt = make_core_project('so-mirror-rej-');
  const zip_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-mirror-badzip-'));
  seed_receiver_extras(tgt);
  const old_zip = path.join(zip_dir, 'old.zip');
  const good_zip = path.join(zip_dir, 'good.zip');
  const corrupt_zip = path.join(zip_dir, 'corrupt.zip');
  try {
    const old_ex = await export_zip_from(old_src, old_zip);
    assert.equal(old_ex.ok, true, old_ex.reason_zh || '');
    assert.equal(old_ex.manifest.mirror_supported, false);
    const old_imp = await import_zip_to(tgt, old_zip, {
      mirror: true,
      apply: true,
      confirm_token: IMPORT_MIRROR_CONFIRM_TOKEN,
    });
    assert.equal(old_imp.ok, false);
    assert.match(old_imp.reason_zh || '', /未標示鏡射就緒|重新匯出/);
    assert.equal(exists_rel(tgt, 'backup/enrichment/stale-cache.json'), true);

    const good_ex = await export_zip_from(complete_src, good_zip);
    assert.equal(good_ex.ok, true, good_ex.reason_zh || '');
    const wrong_pw = await run_data_import({
      project_root_override: tgt,
      input_zip: good_zip,
      password_mode: 'stdin',
      stdin_password: 'definitely-wrong-password',
      mirror: true,
      dry_run: true,
    });
    assert.equal(wrong_pw.ok, false);
    assert.match(wrong_pw.reason_zh || '', /ZIP 驗證失敗|密碼|password|Wrong/i);

    fs.copyFileSync(good_zip, corrupt_zip);
    fs.writeFileSync(corrupt_zip, 'not-a-zip', 'utf8');
    const corrupt = await import_zip_to(tgt, corrupt_zip, {
      mirror: true,
      dry_run: true,
    });
    assert.equal(corrupt.ok, false);
    assert.equal(exists_rel(tgt, 'unmanaged-notes.txt'), true);
    assert.equal(exists_rel(tgt, 'backup/enrichment/stale-cache.json'), true);
  } finally {
    rm_owned(old_src, 'so-mirror-old-');
    rm_owned(complete_src, 'so-mirror-src-');
    rm_owned(tgt, 'so-mirror-rej-');
    rm_owned(zip_dir, 'so-mirror-badzip-');
  }
});

test('較舊 ZIP 與部分失敗會拒絕／還原，不留下半套鏡射', async function () {
  enable_test_env();
  const src = make_mirror_source();
  const tgt = make_core_project('so-mirror-rst-');
  const zip_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-mirror-rstzip-'));
  const zip = path.join(zip_dir, 'rst.zip');
  seed_receiver_extras(tgt);
  const original_rules = read_rel(tgt, 'backup/classification/managed-playlist-rules.json');
  const original_stale = read_rel(tgt, 'backup/enrichment/stale-cache.json');
  try {
    const ex = await export_zip_from(src, zip);
    assert.equal(ex.ok, true, ex.reason_zh || '');

    const state_dir = path.join(tgt, '.data-sync-state');
    fs.mkdirSync(state_dir, { recursive: true });
    fs.writeFileSync(
      path.join(state_dir, 'last-import.json'),
      JSON.stringify({
        schema_version: 1,
        last_bundle_id: 'future-bundle',
        exported_at_from_manifest: '2099-01-01T00:00:00.000Z',
        file_baselines: {},
      }),
      'utf8'
    );
    const stale = await import_zip_to(tgt, zip, {
      mirror: true,
      apply: true,
      confirm_token: IMPORT_MIRROR_CONFIRM_TOKEN,
    });
    assert.equal(stale.ok, false);
    assert.match(stale.reason_zh || '', /較舊/);
    assert.equal(read_rel(tgt, 'backup/classification/managed-playlist-rules.json'), original_rules);

    fs.rmSync(state_dir, { recursive: true, force: true });

    const failed = await import_zip_to(tgt, zip, {
      mirror: true,
      apply: true,
      confirm_token: IMPORT_MIRROR_CONFIRM_TOKEN,
      mirror_hooks: {
        after_apply_copy: function () {
          write_rel(tgt, 'backup/merged/library-v2.json', '{"broken":true}');
        },
      },
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.restore_attempted, true);
    assert.equal(read_rel(tgt, 'backup/classification/managed-playlist-rules.json'), original_rules);
    assert.equal(read_rel(tgt, 'backup/enrichment/stale-cache.json'), original_stale);
    assert.equal(read_rel(tgt, 'unmanaged-notes.txt'), 'leave-me');
    assert.match(read_rel(tgt, 'backup/merged/library-v2.json'), /home-old/);
  } finally {
    rm_owned(src, 'so-mirror-src-');
    rm_owned(tgt, 'so-mirror-rst-');
    rm_owned(zip_dir, 'so-mirror-rstzip-');
  }
});
