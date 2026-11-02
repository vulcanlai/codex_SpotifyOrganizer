/**
 * 第一階段：7-Zip + PTY 隔離驗證（不含正式專案資料）
 * 用法（在 pty-spike 目錄）：
 *   npm install node-pty  或  @cdktf/node-pty-prebuilt-multiarch
 *   node run-spike.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SPIKE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SPIKE_DIR, '..', '..', '..');
const TEST_PASSWORD = 'spike-pty-test-only-not-real';
const REDACT = TEST_PASSWORD;

/** @type {{ phase: string, ok: boolean, detail?: string }[]} */
const report = [];

function log_phase(phase, ok, detail) {
  const safe =
    detail != null
      ? String(detail).split(REDACT).join('[REDACTED]')
      : '';
  report.push({ phase: phase, ok: ok, detail: safe });
  process.stdout.write((ok ? 'OK  ' : 'FAIL') + ' ' + phase);
  if (safe) {
    process.stdout.write(' — ' + safe.slice(0, 200));
  }
  process.stdout.write('\n');
}

/**
 * @returns {Promise<{ spawn: Function, package_name: string }>}
 */
async function load_pty_module() {
  /** @type {string[]} */
  const candidates = ['node-pty', '@cdktf/node-pty-prebuilt-multiarch'];
  for (let i = 0; i < candidates.length; i += 1) {
    const name = candidates[i];
    try {
      const mod = await import(name);
      const spawn_fn = mod.spawn || mod.default?.spawn;
      if (typeof spawn_fn === 'function') {
        return { spawn: spawn_fn, package_name: name };
      }
    } catch {
      /* try next */
    }
  }
  throw new Error('無法載入 node-pty 或 @cdktf/node-pty-prebuilt-multiarch');
}

/**
 * @param {string} executable
 */
function resolve_seven_zip(executable) {
  if (executable) {
    return executable;
  }
  const pf = process.env.ProgramFiles;
  if (pf) {
    const p = path.join(pf, '7-Zip', '7z.exe');
    if (fs.existsSync(p)) {
      return p;
    }
  }
  const probe = spawnSync('where', ['7z'], { encoding: 'utf8', windowsHide: true });
  if (probe.status === 0) {
    const line = (probe.stdout || '').trim().split(/\r?\n/)[0];
    if (line) {
      return line.trim();
    }
  }
  return null;
}

/**
 * @param {import('node-pty').IPty} pty
 * @param {number} ms
 */
function pty_exit(pty, ms) {
  return new Promise(function (resolve) {
    let settled = false;
    const timer = setTimeout(function () {
      if (!settled) {
        settled = true;
        try {
          pty.kill();
        } catch {
          /* */
        }
        resolve({ exitCode: -1, timed_out: true });
      }
    }, ms);
    pty.onExit(function (ev) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: ev.exitCode, timed_out: false });
      }
    });
  });
}

/**
 * @param {{ spawn: Function }} pty_mod
 * @param {string} seven
 * @param {string[]} args
 * @param {string} cwd
 * @param {string | null} password
 * @param {{ expect_password_prompt?: boolean, cancel?: boolean }} opts
 */
async function run_7z_pty(pty_mod, seven, args, cwd, password, opts) {
  /** @type {string[]} */
  const argv_snapshot = args.slice();
  const full_argv = [seven].concat(argv_snapshot);
  for (let i = 0; i < full_argv.length; i += 1) {
    if (full_argv[i].indexOf(TEST_PASSWORD) >= 0) {
      throw new Error('argv 含測試密碼');
    }
    if (/^-p\S/.test(full_argv[i])) {
      throw new Error('argv 含 -p 明文後綴');
    }
  }

  return new Promise(function (resolve, reject) {
    /** @type {string} */
    let buf = '';
    let sent = false;
    const pty = pty_mod.spawn(seven, args, {
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      cwd: cwd,
      env: process.env,
    });

    pty.onData(function (data) {
      buf += data;
      const scrubbed = buf.split(REDACT).join('[REDACTED]');
      if (scrubbed.indexOf(TEST_PASSWORD) >= 0) {
        pty.kill();
        reject(new Error('PTY 輸出含明文密碼'));
        return;
      }
      if (opts.cancel && /password/i.test(buf) && !sent) {
        sent = true;
        pty.kill();
        return;
      }
      if (
        opts.expect_password_prompt !== false &&
        password &&
        !sent &&
        /Enter password|password/i.test(buf)
      ) {
        sent = true;
        pty.write(password + '\r');
      }
    });

    pty_exit(pty, opts.cancel ? 8000 : 120000)
      .then(function (ev) {
        resolve({
          exitCode: ev.exitCode,
          timed_out: ev.timed_out,
          output_scrubbed: buf.split(REDACT).join('[REDACTED]'),
          password_sent: sent,
        });
      })
      .catch(reject);
  });
}

async function main() {
  if (process.platform !== 'win32') {
    log_phase('platform', false, '此 spike 僅在 win32 執行');
    process.exit(1);
  }

  let pty_mod;
  try {
    pty_mod = await load_pty_module();
    log_phase('pty_module_load', true, pty_mod.package_name);
  } catch (err) {
    log_phase('pty_module_load', false, err.message);
    process.exit(1);
  }

  const seven = resolve_seven_zip(process.argv[2]);
  if (!seven) {
    log_phase('seven_zip_resolve', false, '找不到 7z.exe');
    process.exit(1);
  }
  log_phase('seven_zip_resolve', true, path.basename(seven));

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'so-pty-spike-'));
  const staging = path.join(work, 'stg');
  fs.mkdirSync(staging);
  fs.writeFileSync(path.join(staging, 'export-manifest.json'), '{"ok":true}', 'utf8');
  const zip_path = path.join(work, 'aes.zip');

  const add_args = [
    'a',
    '-tzip',
    '-mem=AES256',
    '-p',
    zip_path,
    'export-manifest.json',
  ];
  const add_run = await run_7z_pty(
    pty_mod,
    seven,
    add_args,
    staging,
    TEST_PASSWORD,
    { expect_password_prompt: true }
  );
  log_phase(
    '7z_a_pack',
    add_run.exitCode === 0 && fs.existsSync(zip_path),
    'exit=' +
      add_run.exitCode +
      ' sent=' +
      add_run.password_sent +
      (add_run.timed_out ? ' TIMEOUT' : '')
  );

  const t_run = await run_7z_pty(
    pty_mod,
    seven,
    ['t', '-p', zip_path],
    work,
    TEST_PASSWORD,
    {}
  );
  log_phase(
    '7z_t_ok',
    t_run.exitCode === 0,
    'exit=' + t_run.exitCode + ' wrong_pw=' + /Wrong password/i.test(t_run.output_scrubbed)
  );

  const l_run = await run_7z_pty(
    pty_mod,
    seven,
    ['l', '-slt', '-p', zip_path],
    work,
    TEST_PASSWORD,
    {}
  );
  const has_aes =
    l_run.output_scrubbed.indexOf('AES-256') >= 0 ||
    l_run.output_scrubbed.indexOf('WzAES') >= 0;
  log_phase(
    '7z_l_slt',
    l_run.exitCode === 0 && has_aes,
    'exit=' + l_run.exitCode + ' aes=' + has_aes
  );

  const x_dir = path.join(work, 'out');
  fs.mkdirSync(x_dir);
  const x_run = await run_7z_pty(
    pty_mod,
    seven,
    ['x', '-tzip', '-y', '-o' + x_dir, '-p', zip_path],
    work,
    TEST_PASSWORD,
    {}
  );
  log_phase(
    '7z_x_extract',
    x_run.exitCode === 0 && fs.existsSync(path.join(x_dir, 'export-manifest.json')),
    'exit=' + x_run.exitCode
  );

  const bad_t = await run_7z_pty(
    pty_mod,
    seven,
    ['t', '-p', zip_path],
    work,
    'wrong-password-spike',
    {}
  );
  log_phase(
    '7z_t_wrong_password',
    bad_t.exitCode !== 0 || /Wrong password/i.test(bad_t.output_scrubbed),
    'exit=' + bad_t.exitCode
  );

  const corrupt = path.join(work, 'corrupt.zip');
  fs.writeFileSync(corrupt, 'not-a-zip', 'utf8');
  const corrupt_t = await run_7z_pty(
    pty_mod,
    seven,
    ['t', '-p', corrupt],
    work,
    TEST_PASSWORD,
    {}
  );
  log_phase('7z_t_corrupt_zip', corrupt_t.exitCode !== 0, 'exit=' + corrupt_t.exitCode);

  const cancel_run = await run_7z_pty(
    pty_mod,
    seven,
    ['t', '-p', zip_path],
    work,
    TEST_PASSWORD,
    { cancel: true }
  );
  log_phase(
    '7z_cancel_kill',
    cancel_run.exitCode !== 0 || cancel_run.timed_out,
    'exit=' + cancel_run.exitCode
  );

  const json_out = path.join(work, 'spike-report.json');
  fs.writeFileSync(json_out, JSON.stringify(report, null, 2), 'utf8');
  const json_text = fs.readFileSync(json_out, 'utf8');
  if (json_text.indexOf(TEST_PASSWORD) >= 0) {
    log_phase('report_no_secret', false, 'JSON 含測試密碼');
    process.exit(1);
  }
  log_phase('report_no_secret', true, json_out);

  const failed = report.filter(function (r) {
    return !r.ok;
  });
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(function (err) {
  log_phase('fatal', false, err.message);
  process.exit(1);
});
