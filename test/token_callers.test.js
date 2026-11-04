/** 正式呼叫鏈測試，只能由隔離 runner 執行；不讀取正式 Token。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { TOKEN_FILE, project_root } from '../lib/config.js';
import { get_runtime_token_protection, TokenAccessError } from '../lib/auth/token_access_policy.js';
import { load_tokens, save_tokens } from '../lib/token_store.js';
import { exchange_code_for_tokens, refresh_access_token } from '../lib/spotify_auth.js';
import { get_valid_access_token, spotify_get } from '../lib/spotify_api.js';
import { ensure_authorized, run_with_oauth } from '../lib/oauth_session.js';
import { run_track_enrichment } from '../lib/enrichment/run_enrich.js';

// 防止直接在正式專案執行這組會建立假 Token 的測試。
assert.ok(path.basename(project_root).startsWith('so-token-suite-'));
assert.notEqual(path.resolve(project_root).toLowerCase(), path.resolve(process.env.SPOTIFY_TEST_FORMAL_ROOT || '').toLowerCase());
const USER = 'S-1-5-21-111-222-333-1001';
const OTHER = 'S-1-5-21-111-222-333-1004';
const policy_ok = { ok: true, sid: USER, current_sid: USER, source: 'user_registry', sandbox: false };
const fake = { access_token: 'FAKE_ACCESS_CALLER', refresh_token: 'FAKE_REFRESH_CALLER',
  expires_at: Date.now() + 3600000, scope: 'user-library-read', token_type: 'Bearer' };

function setup(t, initial) {
  assert.equal(fs.existsSync(TOKEN_FILE), false);
  const state = { policy: policy_ok, acl: { ok: true }, current: USER, calls: [], fetches: 0 };
  t.mock.method(cp, 'spawnSync', (command, args, opts) => {
    assert.equal(opts.shell, false);
    assert.equal(path.win32.isAbsolute(command), true);
    if (command.endsWith('whoami.exe')) return { status: 0, stdout: `"Fake user","${state.current}"` };
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    if (script.includes('SPOTIFYORG_AUTHORIZED_WINDOWS_SID')) {
      state.calls.push('policy');
      return { status: 0, stdout: JSON.stringify(state.policy) };
    }
    const action = script.match(/\} '(create|apply|verify)' '((?:[^']|'')*)' /);
    assert.ok(action);
    state.calls.push(action[1]);
    if (action[1] === 'create' && state.acl.ok) fs.writeFileSync(action[2].replaceAll("''", "'"), '', { flag: 'wx' });
    return { status: 0, stdout: JSON.stringify(state.acl) };
  });
  syncBuiltinESMExports();
  if (initial) fs.writeFileSync(TOKEN_FILE, typeof initial === 'string' ? initial : JSON.stringify(initial));
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(TOKEN_FILE, { force: true });
  });
  return state;
}

test('核准來源為使用者登錄設定；程序環境變數不會成為核准依據', t => {
  let script;
  const deps = { platform: 'win32', spawnSync(command, args, opts) {
    assert.ok(command.endsWith('WindowsPowerShell\\v1.0\\powershell.exe'));
    assert.equal(opts.shell, false);
    script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    return { status: 0, stdout: JSON.stringify(policy_ok) };
  } };
  assert.deepEqual(get_runtime_token_protection(deps), { authorized_windows_user_sid: USER });
  assert.match(script, /GetEnvironmentVariable\('SPOTIFYORG_AUTHORIZED_WINDOWS_SID', 'User'\)/);
  assert.match(script, /CodexSandboxUsers/);
  assert.match(script, /identity\.Groups/);
  assert.ok(!script.includes("'Process'"));
});

test('核准錯誤分類不含 SID、子程序輸出或其他機密', async t => {
  for (const reason of ['authorization_required', 'invalid_authorization', 'identity_mismatch',
    'sandbox_identity', 'elevated_identity', 'identity_check_failed']) {
    await t.test(reason, () => {
      assert.throws(() => get_runtime_token_protection({ platform: 'win32', spawnSync: () => ({
        status: 0, stdout: JSON.stringify({ ok: false, reason, secret: fake.access_token, sid: USER }),
      }) }), err => err instanceof TokenAccessError && err.reason === reason && !err.message.includes(USER) && !err.message.includes(fake.access_token));
    });
  }
  for (const [result, reason] of [
    [{ error: new Error(fake.access_token), status: null }, 'execution_failed'],
    [{ status: 5, stdout: fake.access_token }, 'exit_nonzero'],
    [{ status: 0, stdout: fake.access_token }, 'policy_parse_failed'],
    [{ status: 0, stdout: JSON.stringify({ ...policy_ok, current_sid: OTHER }) }, 'policy_parse_failed'],
  ]) assert.throws(() => get_runtime_token_protection({ platform: 'win32', spawnSync: () => result }), { reason });
});

test('正式 load/save 自動傳遞核准 SID，假 Token 可建立及讀回', t => {
  const state = setup(t);
  save_tokens(fake);
  assert.deepEqual(load_tokens(), fake);
  assert.ok(state.calls.includes('create'));
  assert.ok(state.calls.includes('verify'));
  assert.ok(state.calls.filter(c => c === 'policy').length >= 2);
});

test('只有不存在才是未登入；格式錯誤不能當成未登入', t => {
  setup(t);
  assert.equal(load_tokens(), null);
  fs.writeFileSync(TOKEN_FILE, '{FAKE_BROKEN_JSON');
  assert.throws(() => load_tokens(), { reason: 'invalid_token_file' });
  fs.writeFileSync(TOKEN_FILE, '{"access_token":""}');
  assert.throws(() => load_tokens(), { reason: 'invalid_token_file' });
});

test('模擬一般使用者與沙箱：即使 SID 格式正確也不得省略核准', t => {
  const state = setup(t, fake);
  for (const reason of ['authorization_required', 'identity_mismatch', 'sandbox_identity']) {
    state.policy = { ok: false, reason };
    assert.throws(() => load_tokens(), { reason });
    assert.throws(() => save_tokens(fake), { reason });
  }
  assert.equal(state.calls.includes('verify'), false);
  assert.equal(state.calls.includes('create'), false);
});

test('ACL 不安全時正式 load/save 停止；原內容保留且不嘗試 apply', t => {
  const state = setup(t, fake);
  const before = fs.readFileSync(TOKEN_FILE, 'utf8');
  state.acl = { ok: false, reason: 'unsafe_acl' };
  assert.throws(() => load_tokens(), { reason: 'unsafe_acl' });
  assert.throws(() => save_tokens({ ...fake, access_token: 'FAKE_REPLACEMENT' }), { reason: 'unsafe_acl' });
  assert.equal(fs.readFileSync(TOKEN_FILE, 'utf8'), before);
  assert.equal(state.calls.includes('apply'), false);
});

test('作業系統拒絕讀取：明確 access_denied，不回傳 null 或原始例外', t => {
  setup(t, fake);
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    if (file === TOKEN_FILE) throw Object.assign(new Error(fake.access_token), { code: 'EACCES' });
    return open(file, ...args);
  });
  assert.throws(() => load_tokens(), err => err.reason === 'access_denied' && !err.message.includes(fake.access_token));
});

test('lstat 拒絕存取不可當成缺檔，更新不會進入新檔建立', t => {
  const state = setup(t, fake);
  const stat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (file, ...args) => {
    if (file === TOKEN_FILE) throw Object.assign(new Error('FAKE_DENIED'), { code: 'EPERM' });
    return stat(file, ...args);
  });
  assert.throws(() => load_tokens(), { reason: 'access_denied' });
  assert.throws(() => save_tokens(fake), { reason: 'access_denied' });
  assert.equal(state.calls.includes('create'), false);
});

test('Token 載入於 ACL 不安全時不讀取假內容', t => {
  const state = setup(t, fake);
  state.acl = { ok: false, reason: 'unsafe_acl' };
  const read = fs.readFileSync;
  let content_reads = 0;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (file === TOKEN_FILE || typeof file === 'number') content_reads++;
    return read(file, ...args);
  });
  assert.throws(() => load_tokens(), { reason: 'unsafe_acl' });
  assert.equal(content_reads, 0);
});

test('OAuth exchange 正式儲存與 refresh 更新：mock HTTP、核准及 ACL 皆經正式呼叫端', async t => {
  const state = setup(t);
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    state.fetches++;
    const is_refresh = request.body.includes('refresh_token');
    return { ok: true, status: 200, text: async () => JSON.stringify({
      access_token: is_refresh ? 'FAKE_REFRESHED' : fake.access_token,
      ...(is_refresh ? {} : { refresh_token: fake.refresh_token }), token_type: 'Bearer', expires_in: 3600,
    }) };
  });
  await exchange_code_for_tokens('FAKE_CODE', 'FAKE_VERIFIER');
  assert.equal(load_tokens().access_token, fake.access_token);
  await refresh_access_token(fake.refresh_token);
  assert.equal(load_tokens().access_token, 'FAKE_REFRESHED');
  assert.equal(load_tokens().refresh_token, fake.refresh_token);
  assert.equal(state.fetches, 2);
});

test('核准缺失或 ACL 不安全：OAuth／refresh 在 HTTP 請求前停止', async t => {
  const state = setup(t, fake);
  t.mock.method(globalThis, 'fetch', () => { state.fetches++; throw new Error('Unexpected HTTP'); });
  state.policy = { ok: false, reason: 'authorization_required' };
  await assert.rejects(exchange_code_for_tokens('FAKE', 'FAKE'), { reason: 'authorization_required' });
  state.policy = policy_ok;
  state.acl = { ok: false, reason: 'unsafe_acl' };
  await assert.rejects(refresh_access_token(fake.refresh_token), { reason: 'unsafe_acl' });
  assert.equal(state.fetches, 0);
});

test('網路往返時核准撤銷：不寫入新 Token', async t => {
  const state = setup(t, fake);
  const original = fs.readFileSync(TOKEN_FILE, 'utf8');
  t.mock.method(globalThis, 'fetch', async () => {
    state.policy = { ok: false, reason: 'authorization_required' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'FAKE_NEVER_SAVED', expires_in: 3600 }) };
  });
  await assert.rejects(refresh_access_token(fake.refresh_token), { reason: 'authorization_required' });
  assert.equal(fs.readFileSync(TOKEN_FILE, 'utf8'), original);
});

test('API 取得有效 Token 與 401 refresh 重試均沿用核准來源（mock）', async t => {
  const state = setup(t, fake);
  assert.equal(await get_valid_access_token(), fake.access_token);
  let api_calls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('/api/token')) return { ok: true, status: 200,
      text: async () => JSON.stringify({ access_token: 'FAKE_AFTER_401', expires_in: 3600 }) };
    api_calls++;
    return { ok: api_calls > 1, status: api_calls === 1 ? 401 : 200,
      text: async () => '{"id":"FAKE_PROFILE"}' };
  });
  const result = await spotify_get('/me');
  assert.equal(result.id, 'FAKE_PROFILE');
  assert.equal(load_tokens().access_token, 'FAKE_AFTER_401');
  assert.equal(api_calls, 2);
  assert.ok(state.calls.includes('policy'));
});

test('refresh 儲存失敗必須傳遞，不轉成瀏覽器重新授權', async t => {
  const state = setup(t, { ...fake, expires_at: 0 });
  t.mock.method(globalThis, 'fetch', async () => {
    state.acl = { ok: false, reason: 'unsafe_acl' };
    return { ok: true, status: 200, text: async () => '{"access_token":"FAKE_UNSAVED","expires_in":3600}' };
  });
  let warned = false;
  t.mock.method(console, 'warn', () => { warned = true; });
  await assert.rejects(ensure_authorized([]), { reason: 'unsafe_acl' });
  assert.equal(warned, false);
});

test('未核准時 run_with_oauth 不啟動 callback 伺服器', async t => {
  const state = setup(t);
  state.policy = { ok: false, reason: 'sandbox_identity' };
  let started = false;
  t.mock.method(http, 'createServer', () => { started = true; throw new Error('Unexpected OAuth'); });
  await assert.rejects(run_with_oauth(async () => {}), { reason: 'sandbox_identity' });
  assert.equal(started, false);
});

test('補全遇到 Token 存取錯誤立即停止，不寫入歌曲快取或 checkpoint', async () => {
  let fetched = 0, persisted = 0;
  await assert.rejects(run_track_enrichment({ max: 2, delay_ms: 0,
    fetch_track: async () => { fetched++; throw new TokenAccessError('access_denied'); },
    persist_fn: () => { persisted++; },
  }), { reason: 'access_denied' });
  assert.equal(fetched, 1);
  assert.equal(persisted, 0);
});

const native = process.platform === 'win32';
const whoami = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32/whoami.exe');
const nativeIdentity = native ? cp.spawnSync(whoami, ['/user', '/fo', 'csv', '/nh'], {
  shell: false, windowsHide: true, encoding: 'utf8', timeout: 15000,
}) : null;
const nativeSandbox = nativeIdentity?.status === 0 && /"[^"\r\n]*\\CodexSandbox/i.test(nativeIdentity.stdout);
test('原生沙箱政策拒絕正式存取（不讀取任何 Token）', { skip: !nativeSandbox }, () => {
  // 目前無法取得一般使用者執行內容；僅驗證原生沙箱的拒絕行為。
  assert.throws(() => get_runtime_token_protection(), { reason: 'sandbox_identity' });
});

const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
const powershell = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
for (const shell of ['PowerShell', 'Git Bash']) {
  test(`${shell} 啟動正式 server.js：沙箱在 Token 存取及網路前停止`, {
    skip: !nativeSandbox || (shell === 'Git Bash' && !fs.existsSync(gitBash)),
  }, () => {
    const script = path.join(project_root, 'server.js');
    const guard = fileURLToPath(new URL('./helpers/offline_guard.cjs', import.meta.url));
    const args = ['--require', guard, script];
    const child = shell === 'PowerShell'
      ? cp.spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', `& ${quote(process.execPath)} ${args.map(quote).join(' ')}`], { cwd: project_root, encoding: 'utf8', timeout: 20000 })
      : cp.spawnSync(gitBash, ['--noprofile', '--norc', '-c', 'exec "$1" "$2" "$3" "$4"', 'caller-test', process.execPath, ...args], { cwd: project_root, encoding: 'utf8', timeout: 20000 });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /Codex.*Token/);
    assert.ok(!child.stdout.includes('http://'));
    assert.equal(fs.existsSync(TOKEN_FILE), false);
  });
}
