/** 僅使用新建的專用 TEMP；成功與失敗均保留假檔案與診斷快照，不碰既有測試目錄。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const tool = fileURLToPath(new URL('../scripts/acl-recovery-test.js', import.meta.url));
const native = process.platform === 'win32';
function sandbox() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'so-acl-probe-tests-'));
  console.log('保留測試資料：' + temp);
  return { temp, env: { ...process.env, TMP: temp, TEMP: temp } };
}
function invoke(context, command, extra = []) {
  const child = spawnSync(process.execPath, [tool, command, ...extra], {
    env: context.env, encoding: 'utf8', shell: false, timeout: 180000, maxBuffer: 1024 * 1024,
  });
  const reports = String(child.stdout || '').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  assert.ok(!/S-1-5-21-\d+/.test((child.stdout || '') + (child.stderr || '')));
  return { ...child, reports };
}

test('拒絕真實 Token 目標參數及 Git 儲存庫內的 TEMP', { skip: !native }, () => {
  const ctx = sandbox();
  const r = invoke(ctx, 'run', ['.spotify_tokens.json']);
  assert.equal(r.status, 1);
  assert.deepEqual(fs.readdirSync(ctx.temp), []);
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const blocked = invoke({ ...ctx, env: { ...ctx.env, TEMP: repo, TMP: repo } }, 'run');
  assert.equal(blocked.status, 1);
  assert.equal(blocked.reports[0].reason, 'temp_inside_repository_rejected');
});

test('硬連結數量變動時拒絕復原，保留假檔案與快照', { skip: !native }, () => {
  const ctx = sandbox();
  const initial = invoke(ctx, 'run');
  assert.equal(initial.status, 0, JSON.stringify(initial.reports));
  const root = initial.reports[0].directory;
  const target = path.join(root, 'dummy.txt');
  fs.linkSync(target, path.join(ctx.temp, 'fake-hardlink.txt'));
  const failure = invoke(ctx, 'restore');
  assert.equal(failure.status, 1);
  assert.equal(failure.reports[0].reason, 'multiple_links_rejected');
  assert.ok(fs.existsSync(path.join(root, 'snapshot.bin')));
  assert.equal(fs.readFileSync(target, 'utf8'), 'FAKE ACL TEST DATA ONLY');
});

test('原 DACL 寫回、正式 helper 限制、跨程序復原與假檔案讀寫', { skip: !native }, () => {
  const ctx = sandbox();
  const r = invoke(ctx, 'run');
  assert.equal(r.status, 0, JSON.stringify(r.reports));
  assert.deepEqual(r.reports.map(p => p.stage), ['prepare','write-original','restrict','restore','status']);
  assert.equal(r.reports.at(-1).restored, true);
  assert.equal(r.reports.at(-1).cleanup_eligible, true);
  const root = r.reports[0].directory;
  assert.equal(path.dirname(root).toLowerCase(), ctx.temp.toLowerCase());
  assert.equal(fs.readFileSync(path.join(root, 'dummy.txt'), 'utf8'), 'FAKE ACL TEST DATA ONLY');
  assert.ok(fs.existsSync(path.join(root, 'snapshot.bin')));
  assert.ok(!fs.readFileSync(path.join(root, 'snapshot.bin')).includes(Buffer.from('FAKE ACL TEST DATA ONLY')));
  const restore = invoke(ctx, 'restore');
  assert.equal(restore.status, 0);
  assert.equal(restore.reports[0].restored, true);
  const before = fs.readFileSync(path.join(root, 'result.json'), 'utf8');
  const repeated = invoke(ctx, 'run');
  assert.equal(repeated.status, 1);
  assert.equal(repeated.reports[0].reason, 'existing_directory_preserved');
  assert.equal(fs.readFileSync(path.join(root, 'result.json'), 'utf8'), before);
  const status = invoke(ctx, 'status');
  assert.equal(status.status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'result.json'), 'utf8'), before);
});

test('快照損壞及已簽署的錯誤目標仍被拒絕；失敗保留診斷', { skip: !native }, () => {
  const ctx = sandbox();
  const initial = invoke(ctx, 'run');
  assert.equal(initial.status, 0, JSON.stringify(initial.reports));
  const root = initial.reports[0].directory;
  const file = path.join(root, 'snapshot.bin');
  const original = fs.readFileSync(file);
  const corrupted = Buffer.from(original);
  corrupted[Math.floor(corrupted.length / 2)] ^= 1;
  fs.writeFileSync(file, corrupted);
  const checksumFailure = invoke(ctx, 'restore');
  assert.equal(checksumFailure.status, 1);
  assert.equal(checksumFailure.reports[0].reason, 'snapshot_authentication_failed');
  const wrongTarget = JSON.parse(original.toString('utf8'));
  wrongTarget.target = '.spotify_tokens.json';
  const changed = Buffer.from(JSON.stringify(wrongTarget));
  fs.writeFileSync(file, changed);
  const key = fs.readFileSync(path.join(root, 'snapshot.key'));
  fs.writeFileSync(path.join(root, 'snapshot.hmac'), crypto.createHmac('sha256', key).update(changed).digest('hex'));
  const authenticationFailure = invoke(ctx, 'restore');
  assert.equal(authenticationFailure.status, 1);
  assert.equal(authenticationFailure.reports[0].reason, 'snapshot_target_mismatch');
  assert.ok(fs.existsSync(file));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'result.json'), 'utf8')).ok, false);
  assert.equal(fs.readFileSync(path.join(root, 'dummy.txt'), 'utf8'), 'FAKE ACL TEST DATA ONLY');
});

test('目標被替換為其他檔案時拒絕復原，不修改替代檔案', { skip: !native }, () => {
  const ctx = sandbox();
  const initial = invoke(ctx, 'run');
  assert.equal(initial.status, 0, JSON.stringify(initial.reports));
  const root = initial.reports[0].directory;
  const target = path.join(root, 'dummy.txt');
  // 舊檔移至本測試新建的 TEMP 範圍保留，避免檔案識別被重用。
  fs.renameSync(target, path.join(ctx.temp, 'preserved-original-dummy.txt'));
  fs.writeFileSync(target, 'FAKE_REPLACEMENT');
  const failure = invoke(ctx, 'restore');
  assert.equal(failure.status, 1);
  assert.equal(failure.reports[0].reason, 'file_identity_mismatch');
  assert.equal(fs.readFileSync(target, 'utf8'), 'FAKE_REPLACEMENT');
});
