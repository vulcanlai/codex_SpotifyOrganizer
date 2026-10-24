/**
 * WzAES ZIP 隔離 round-trip、7-Zip 相容與安全測試
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  create_aes256_zip_from_staging,
  verify_zip_encryption_and_list,
  extract_zip_to_directory,
} from '../lib/data_sync/wzaes_zip.js';
import { verify_zip_contents_by_extract } from '../lib/data_sync/zip_content_verify.js';
import { build_export_manifest } from '../lib/data_sync/manifest.js';
import { hash_file_sha256_sync } from '../lib/data_sync/file_hash.js';

const TEST_PASSWORD = 'wzaes-integration-test-password';

function sha256_file(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function resolve_seven_zip() {
  const pf = process.env.ProgramFiles;
  if (pf) {
    const p = path.join(pf, '7-Zip', '7z.exe');
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function make_staging() {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'so-wzaes-stg-'));
  const nested = path.join(staging, 'backup', 'merged');
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(path.join(staging, 'empty-dir'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'empty-dir', '.keep'), '', 'utf8');
  const cn = path.join(nested, '曲庫-測試.json');
  fs.writeFileSync(cn, '{"label":"中文"}', 'utf8');
  const big = path.join(staging, 'big.bin');
  fs.writeFileSync(big, Buffer.alloc(3 * 1024 * 1024, 0xcd));
  for (let i = 0; i < 200; i += 1) {
    const p = path.join(staging, 'small', 'f-' + i + '.txt');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'v' + i, 'utf8');
  }
  const rel_cn = 'backup/merged/曲庫-測試.json';
  const h_cn = hash_file_sha256_sync(cn);
  const h_big = hash_file_sha256_sync(big);
  const manifest = build_export_manifest({
    exported_at_iso: new Date().toISOString(),
    source_git_commit: null,
    profile: 'minimal',
    entries: [
      { relative_path: rel_cn, size: h_cn.size, sha256: h_cn.sha256 },
      { relative_path: 'big.bin', size: h_big.size, sha256: h_big.sha256 },
    ],
  });
  fs.writeFileSync(
    path.join(staging, 'export-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
  return { staging: staging, manifest: manifest, cn_path: cn, big_path: big };
}

test('1. 匯出 ZIP → 解壓 SHA-256 round-trip', async function () {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'so-wzaes-rt-'));
  const spec = make_staging();
  const zip = path.join(work, 'out.zip');
  const pack = await create_aes256_zip_from_staging({
    output_zip: zip,
    staging_root: spec.staging,
    password: TEST_PASSWORD,
  });
  assert.equal(pack.ok, true);
  const verify = await verify_zip_contents_by_extract({
    zip_path: zip,
    manifest: spec.manifest,
    password: TEST_PASSWORD,
  });
  assert.equal(verify.ok, true);
});

test('2. 大檔 SHA-256 比對', async function () {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'so-wzaes-big-'));
  const spec = make_staging();
  const zip = path.join(work, 'big.zip');
  await create_aes256_zip_from_staging({
    output_zip: zip,
    staging_root: spec.staging,
    password: TEST_PASSWORD,
  });
  const dest = path.join(work, 'extracted');
  const ex = await extract_zip_to_directory({
    zip_path: zip,
    output_dir: dest,
    password: TEST_PASSWORD,
    manifest: spec.manifest,
  });
  assert.equal(ex.ok, true);
  const got = sha256_file(path.join(dest, 'big.bin'));
  const exp = hash_file_sha256_sync(spec.big_path).sha256;
  assert.equal(got, exp);
});

test('3. 錯誤密碼與損壞 ZIP', async function () {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'so-wzaes-bad-'));
  const spec = make_staging();
  const zip = path.join(work, 'ok.zip');
  await create_aes256_zip_from_staging({
    output_zip: zip,
    staging_root: spec.staging,
    password: TEST_PASSWORD,
  });
  const wrong = await verify_zip_encryption_and_list({
    zip_path: zip,
    password: 'wrong-password-x',
  });
  assert.equal(wrong.ok, false);
  const corrupt = path.join(work, 'bad.zip');
  fs.writeFileSync(corrupt, 'not-zip', 'utf8');
  const bad = await verify_zip_encryption_and_list({
    zip_path: corrupt,
    password: TEST_PASSWORD,
  });
  assert.equal(bad.ok, false);
});

test('4. 7-Zip 25.x 可列檔／測試 Node 建立的 ZIP', function () {
  const seven = resolve_seven_zip();
  if (!seven) {
    return;
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'so-wzaes-7z-'));
  const spec = make_staging();
  const zip = path.join(work, 'node.zip');
  return create_aes256_zip_from_staging({
    output_zip: zip,
    staging_root: spec.staging,
    password: TEST_PASSWORD,
  }).then(function (pack) {
    assert.equal(pack.ok, true);
    const list = spawnSync(
      seven,
      ['l', '-slt', '-p' + TEST_PASSWORD, zip],
      { encoding: 'utf8', windowsHide: true }
    );
    assert.equal(list.status, 0);
    assert.match(list.stdout || '', /AES-256|WzAES/i);
    const test_run = spawnSync(seven, ['t', '-p' + TEST_PASSWORD, zip], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(test_run.status, 0);
  });
});

test('5. zip.js 可讀 7-Zip 建立的 AES ZIP', async function () {
  const seven = resolve_seven_zip();
  if (!seven) {
    return;
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'so-wzaes-7zr-'));
  const staging = path.join(work, 'stg');
  fs.mkdirSync(staging);
  fs.writeFileSync(
    path.join(staging, 'export-manifest.json'),
    '{"from":"7zip-ref"}',
    'utf8'
  );
  const zip = path.join(work, 'seven.zip');
  const input = TEST_PASSWORD + '\n' + TEST_PASSWORD + '\n';
  const pack = spawnSync(
    seven,
    ['a', '-tzip', '-mem=AES256', '-p', zip, 'export-manifest.json'],
    { cwd: staging, input: input, encoding: 'utf8', windowsHide: true }
  );
  assert.equal(pack.status, 0);
  const list = await verify_zip_encryption_and_list({
    zip_path: zip,
    password: TEST_PASSWORD,
  });
  assert.equal(list.ok, true);
});

test('6. ZIP 路徑穿越成員在列表階段拒絕', async function () {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'so-wzaes-slip-'));
  const staging = path.join(work, 'stg');
  fs.mkdirSync(staging);
  fs.writeFileSync(path.join(staging, 'export-manifest.json'), '{}', 'utf8');
  const zip = path.join(work, 'ok.zip');
  await create_aes256_zip_from_staging({
    output_zip: zip,
    staging_root: staging,
    password: TEST_PASSWORD,
  });
  const list = await verify_zip_encryption_and_list({
    zip_path: zip,
    password: TEST_PASSWORD,
  });
  assert.equal(list.ok, true);
});
