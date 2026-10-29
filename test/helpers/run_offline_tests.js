import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const formal = path.resolve(root);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-offline-suite-'));
const project = path.join(temp, 'project');
const scratch = path.join(temp, 'scratch');
const g3 = process.argv.includes('--g3');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const unit = pkg.scripts['test:unit'];
if (!unit?.startsWith('node --test --test-concurrency=1 ')) throw new Error('Unexpected test:unit command');
const args = unit.split(/\s+/).slice(1);
if (g3) {
  const names = new Set(['g3_b5', 'g3_b6', 'g3_c1', 'g3_c2', 'g3_d1', 'g3_f1', 'g3_f2', 'g3_f3', 'g3_f4', 'g3_f5', 'g3_f6']);
  args.splice(2, args.length, ...unit.split(/\s+/).filter(p => names.has(path.basename(p, '.test.js'))));
}
function hashes() {
  const out = {};
  const base = path.join(root, 'backup');
  if (!fs.existsSync(base)) return out;
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out[path.relative(base, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  }
  walk(base);
  return out;
}
const before = hashes();
try {
  fs.mkdirSync(project);
  fs.mkdirSync(scratch);
  // 不讀取或複製 .env、token、SSH、Git 或其他本機設定。
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if ((e.name.startsWith('.') && !['.env.example', '.gitignore'].includes(e.name)) || /token|credential|secret/i.test(e.name)) continue;
    if (g3 && !['lib', 'test', 'package.json'].includes(e.name)) continue;
    fs.cpSync(path.join(root, e.name), path.join(project, e.name), {
      recursive: true, filter: src => !fs.lstatSync(src).isSymbolicLink(),
    });
  }
  const guard = path.join(project, 'test/helpers/offline_guard.cjs');
  console.log(`Offline ${g3 ? 'G3' : 'full'} suite; Node ${process.version}; isolated copy; fake Client ID.`);
  const child = spawnSync(process.execPath, args, {
    cwd: project, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env, TEMP: scratch, TMP: scratch,
      SPOTIFY_CLIENT_ID: 'offline-test-client-id-not-a-real-credential',
      SPOTIFYORG_G3_EVIDENCE_DIR: '',
      SPOTIFY_TEST_FORMAL_ROOT: formal,
      NODE_OPTIONS: '--require ' + JSON.stringify(guard),
    },
  });
  if (child.error) throw child.error;
  const lines = (child.stdout + '\n' + child.stderr).split(/\r?\n/);
  console.log(lines.filter(l => /^# (tests|suites|pass|fail|cancelled|skipped|duration_ms) /.test(l)).join('\n'));
  if (child.status !== 0) {
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*not ok /.test(lines[i])) console.log(lines.slice(Math.max(0, i - 1), i + 35).join('\n'));
    }
    if (!lines.some(l => /^# tests /.test(l))) console.log(lines.slice(-80).join('\n'));
  }
  process.exitCode = child.status === 0 ? 0 : 1;
} finally {
  const after = hashes();
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]);
  console.log(JSON.stringify({ backup_files: Object.keys(before).length, backup_sha256_unchanged: !changed.length, changed_paths: changed }));
  if (changed.length) process.exitCode = 1;
  const base = path.resolve(os.tmpdir());
  if (path.dirname(temp).toLowerCase() !== base.toLowerCase() || !path.basename(temp).startsWith('spotify-offline-suite-')) throw new Error('Unsafe cleanup');
  fs.rmSync(temp, { recursive: true, force: true });
  console.log('Test temporary workspace cleaned: ' + !fs.existsSync(temp));
}
