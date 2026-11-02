/**
 * AES-256 (WzAES) 隔離概念驗證 — 不使用正式專案資料
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import archiverZipEncrypted from 'archiver-zip-encrypted';
import { ZipReader, BlobReader, BlobWriter } from '@zip.js/zip.js';

const SPIKE_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_PASSWORD = 'aes-spike-test-password-only';
const REDACT = TEST_PASSWORD;

/** @type {{ phase: string, ok: boolean, detail?: string }[]} */
const report = [];

function log_phase(phase, ok, detail) {
  const safe =
    detail != null ? String(detail).split(REDACT).join('[REDACTED]') : '';
  report.push({ phase: phase, ok: ok, detail: safe });
  process.stdout.write((ok ? 'OK  ' : 'FAIL') + ' ' + phase);
  if (safe) {
    process.stdout.write(' — ' + safe.slice(0, 220));
  }
  process.stdout.write('\n');
}

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
  const probe = spawnSync('where', ['7z'], { encoding: 'utf8', windowsHide: true });
  if (probe.status === 0) {
    return (probe.stdout || '').trim().split(/\r?\n/)[0].trim();
  }
  return null;
}

/**
 * @param {string} output_zip
 * @param {{ root: string, entries: { rel: string, abs: string }[] }} spec
 */
function node_create_aes_zip(output_zip, spec) {
  return new Promise(function (resolve, reject) {
    archiver.registerFormat('zip-encrypted', archiverZipEncrypted);
    const out = fs.createWriteStream(output_zip);
    const archive = archiver.create('zip-encrypted', {
      zlib: { level: 6 },
      encryptionMethod: 'aes256',
      password: TEST_PASSWORD,
    });
    out.on('close', function () {
      resolve(undefined);
    });
    archive.on('error', reject);
    archive.pipe(out);
    for (let i = 0; i < spec.entries.length; i += 1) {
      const e = spec.entries[i];
      archive.file(e.abs, { name: e.rel.replace(/\\/g, '/') });
    }
    archive.finalize();
  });
}

/**
 * @param {string} zip_path
 * @param {string} password
 */
async function zipjs_list_and_read(zip_path, password) {
  const buf = fs.readFileSync(zip_path);
  const reader = new ZipReader(new BlobReader(new Blob([buf])), {
    password: password,
  });
  const entries = await reader.getEntries();
  /** @type {{ name: string, bytes: Uint8Array | null }[]} */
  const out = [];
  for (let i = 0; i < entries.length; i += 1) {
    const ent = entries[i];
    if (ent.directory) {
      out.push({ name: ent.filename, bytes: null });
      continue;
    }
    const blob = await ent.getData(new BlobWriter());
    const ab = await blob.arrayBuffer();
    out.push({ name: ent.filename, bytes: new Uint8Array(ab) });
  }
  await reader.close();
  return out;
}

/**
 * 7-Zip 建立 AES ZIP（測試用 stdin pipe，非正式模式）
 */
function seven_zip_create_aes(zip_path, staging_root, rel_files) {
  /** @type {string[]} */
  const args = ['a', '-tzip', '-mem=AES256', '-p', zip_path];
  for (let i = 0; i < rel_files.length; i += 1) {
    args.push(rel_files[i]);
  }
  const input = TEST_PASSWORD + '\n' + TEST_PASSWORD + '\n';
  const run = spawnSync(resolve_seven_zip(), args, {
    cwd: staging_root,
    input: input,
    encoding: 'utf8',
    windowsHide: true,
  });
  return run.status === 0;
}

/**
 * 7z l -slt 檢查 WzAES（spike 內部使用 argv -p，不寫入 report）
 */
function seven_zip_probe_wzaes(zip_path) {
  const seven = resolve_seven_zip();
  if (!seven) {
    return { ok: false, reason: 'no 7z' };
  }
  const args = ['l', '-slt', '-p' + TEST_PASSWORD, zip_path];
  const run = spawnSync(seven, args, { encoding: 'utf8', windowsHide: true });
  const text = (run.stdout || '') + (run.stderr || '');
  const scrub = text.split(REDACT).join('[REDACTED]');
  return {
    ok: run.status === 0 && /Method = AES-256|WzAES/i.test(text),
    exit: run.status,
    has_wzaes: /WzAES|AES-256/i.test(scrub),
  };
}

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'so-aes-spike-'));
  const staging = path.join(work, 'staging');
  fs.mkdirSync(staging, { recursive: true });

  const nested = path.join(staging, 'backup', 'merged');
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(path.join(staging, 'empty-dir'), { recursive: true });
  const cn_file = path.join(nested, '曲庫-測試.json');
  fs.writeFileSync(cn_file, '{"label":"中文檔名"}', 'utf8');
  const special = path.join(staging, 'reports', 'a=b#test.txt');
  fs.mkdirSync(path.dirname(special), { recursive: true });
  fs.writeFileSync(special, 'special=chars', 'utf8');

  /** @type {{ rel: string, abs: string }[]} */
  const entries = [
    { rel: 'backup/merged/曲庫-測試.json', abs: cn_file },
    { rel: 'reports/a=b#test.txt', abs: special },
    { rel: 'empty-dir/.keep', abs: path.join(staging, 'empty-dir', '.keep') },
  ];
  fs.writeFileSync(path.join(staging, 'empty-dir', '.keep'), '', 'utf8');

  for (let i = 0; i < 200; i += 1) {
    const p = path.join(staging, 'small', 'f-' + i + '.txt');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x' + i, 'utf8');
    entries.push({ rel: 'small/f-' + i + '.txt', abs: p });
  }

  const big_path = path.join(staging, 'big.bin');
  fs.writeFileSync(big_path, Buffer.alloc(3 * 1024 * 1024, 0xab));
  entries.push({ rel: 'big.bin', abs: big_path });

  const node_zip = path.join(work, 'node-aes.zip');
  try {
    await node_create_aes_zip(node_zip, { root: staging, entries: entries });
    log_phase('node_create_aes256', fs.existsSync(node_zip), path.basename(node_zip));
  } catch (err) {
    log_phase('node_create_aes256', false, err.message);
  }

  try {
    const read_ok = await zipjs_list_and_read(node_zip, TEST_PASSWORD);
    const cn = read_ok.find(function (e) {
      return e.name.indexOf('曲庫') >= 0;
    });
    log_phase(
      'zipjs_read_node_zip_ok',
      cn != null && cn.bytes != null,
      'entries=' + read_ok.length
    );
    const h1 = crypto.createHash('sha256').update(cn.bytes).digest('hex');
    const h2 = sha256_file(cn_file);
    log_phase('sha256_match_after_roundtrip', h1 === h2, h1 === h2 ? 'match' : 'mismatch');
  } catch (err) {
    log_phase('zipjs_read_node_zip_ok', false, err.message);
  }

  try {
    await zipjs_list_and_read(node_zip, 'wrong-password');
    log_phase('zipjs_wrong_password', false, 'should have thrown');
  } catch {
    log_phase('zipjs_wrong_password', true, 'rejected');
  }

  const probe_node = seven_zip_probe_wzaes(node_zip);
  log_phase(
    '7zip_list_node_zip_wzaes',
    probe_node.ok,
    'exit=' + probe_node.exit + ' wzaes=' + probe_node.has_wzaes
  );

  const seven_staging = path.join(work, '7z-staging');
  fs.mkdirSync(seven_staging, { recursive: true });
  fs.writeFileSync(
    path.join(seven_staging, 'export-manifest.json'),
    '{"from":"7zip"}',
    'utf8'
  );
  const seven_zip = path.join(work, 'seven-aes.zip');
  const packed = seven_zip_create_aes(seven_zip, seven_staging, [
    'export-manifest.json',
  ]);
  log_phase('7zip_create_aes_reference', packed && fs.existsSync(seven_zip), '');

  try {
    const from7 = await zipjs_list_and_read(seven_zip, TEST_PASSWORD);
    const man = from7.find(function (e) {
      return e.name === 'export-manifest.json';
    });
    log_phase(
      'zipjs_read_7zip_zip',
      man != null && man.bytes != null,
      from7.length + ' entries'
    );
  } catch (err) {
    log_phase('zipjs_read_7zip_zip', false, err.message);
  }

  const corrupt = path.join(work, 'corrupt.zip');
  fs.writeFileSync(corrupt, 'not-a-zip-file', 'utf8');
  try {
    await zipjs_list_and_read(corrupt, TEST_PASSWORD);
    log_phase('corrupt_zip', false, 'should fail');
  } catch {
    log_phase('corrupt_zip', true, 'rejected');
  }

  const report_path = path.join(work, 'aes-spike-report.json');
  fs.writeFileSync(report_path, JSON.stringify(report, null, 2), 'utf8');
  const body = fs.readFileSync(report_path, 'utf8');
  log_phase(
    'report_no_secret',
    body.indexOf(TEST_PASSWORD) < 0,
    report_path
  );

  const failed = report.filter(function (r) {
    return !r.ok;
  });
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(function (err) {
  log_phase('fatal', false, err.message);
  process.exit(1);
});
