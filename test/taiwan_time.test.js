import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { format_taiwan_datetime, format_taiwan_retry_time } from '../lib/taiwan_time.js';
import { TOKEN_FILE } from '../lib/config.js';
import { spotify_api_call, SpotifyRequestError } from '../lib/spotify_api.js';
import { create_track_api_budget } from '../lib/enrichment/track_api_budget.js';
import {
  compute_retry_not_before_iso, parse_retry_after_header,
  format_taiwan_time_from_iso, print_rate_limit_cooldown_notice,
  GlobalRateLimitCooldownError,
} from '../lib/enrichment/rate_limit_state.js';

const cases = [
  ['2026-11-02T15:32:13Z', '2026/11/02 23:32:13', '2026/11/02 23:33'],
  ['2026-11-02T15:32:00Z', '2026/11/02 23:32:00', '2026/11/02 23:32'],
  ['2026-11-02T15:32:00.001Z', '2026/11/02 23:32:00', '2026/11/02 23:33'],
  ['2026-11-02T15:59:59Z', '2026/11/02 23:59:59', '2026/11/03 00:00'],
  ['2026-11-30T15:59:59Z', '2026/11/30 23:59:59', '2026/12/01 00:00'],
  ['2026-12-31T15:59:59.999Z', '2026/12/31 23:59:59', '2027/01/01 00:00'],
  ['2028-02-29T15:59:59Z', '2028/02/29 23:59:59', '2028/03/01 00:00'],
];
for (const [iso, exact, rounded] of cases) {
  test(`台灣時間與向上取整：${iso}`, () => {
    assert.equal(format_taiwan_time_from_iso(iso), exact + '（台灣時間）');
    assert.equal(format_taiwan_retry_time(iso), rounded + '（台灣時間）');
    assert.ok(Math.ceil(Date.parse(iso) / 60000) * 60000 >= Date.parse(iso));
  });
}

test('無可靠期限時不虛構日期', () => {
  for (const input of [null, undefined, '', 'invalid', NaN, false]) {
    assert.match(format_taiwan_datetime(input), /未知/);
    assert.match(format_taiwan_retry_time(input), /未知/);
  }
});

test('429 通知、啟動阻擋與其他端點使用同樣日期，推估明確標註', t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  const now = Date.parse('2026-11-02T15:30:13Z');
  const parsed = parse_retry_after_header('120', now);
  const state = {
    observed_at: new Date(now).toISOString(), retry_after_seconds: parsed.retry_after_seconds,
    retry_not_before: compute_retry_not_before_iso(now, parsed.retry_after_seconds),
  };
  print_rate_limit_cooldown_notice(state, now);
  const output = logs.join('\n');
  assert.match(output, /冷卻截止： 2026\/11\/02 23:32:13（台灣時間）/);
  assert.match(output, /建議重新執行： 2026\/11\/02 23:33（台灣時間）/);
  assert.match(output, /剩餘等待： 2 分/);
  const blocked = new GlobalRateLimitCooldownError(state, 120000);
  assert.match(blocked.message, /建議重新執行：2026\/11\/02 23:33/);
  assert.match(blocked.message, /剩餘等待：2 分/);
  logs.length = 0;
  print_rate_limit_cooldown_notice({ ...state, retry_after_inferred: true }, now, { persisted: false });
  assert.match(logs.join('\n'), /推估/);
  assert.doesNotMatch(logs.join('\n'), /已記錄/);
  logs.length = 0;
  print_rate_limit_cooldown_notice({ retry_not_before: null }, now, { persisted: false });
  assert.match(logs.join('\n'), /剩餘等待：未知/);
  assert.doesNotMatch(logs.join('\n'), /1970|可進行/);
});

test('JS 格式不受主機時區或預設曆法影響', () => {
  const module_url = new URL('../lib/taiwan_time.js', import.meta.url).href;
  for (const [TZ, LANG] of [['UTC', 'th_TH.UTF-8'], ['America/Los_Angeles', 'zh_TW.UTF-8']]) {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { format_taiwan_datetime } from ${JSON.stringify(module_url)}; console.log(format_taiwan_datetime('2026-11-02T15:32:13Z'));`],
    { encoding: 'utf8', env: { ...process.env, TZ, LANG } });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), '2026/11/02 23:32:13（台灣時間）');
  }
});

test('模擬 Spotify Track 與其他 API 429，不連網或更新 Token，保留停止與預算', async t => {
  const now = Date.parse('2026-11-02T15:30:13Z');
  t.mock.method(Date, 'now', () => now);
  const exists = fs.existsSync.bind(fs);
  const read = fs.readFileSync.bind(fs);
  t.mock.method(fs, 'existsSync', p => p === TOKEN_FILE || exists(p));
  t.mock.method(fs, 'readFileSync', (p, ...args) => p === TOKEN_FILE
    ? JSON.stringify({ access_token: 'offline-fake-token', expires_at: now + 3600000 }) : read(p, ...args));
  t.mock.method(fs, 'writeFileSync', () => assert.fail('此查詢不應寫入檔案'));
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts += 1;
    return new Response('{}', { status: 429, headers: { 'Retry-After': '120' } });
  });
  for (const route of ['/tracks/offline', '/albums/offline']) {
    logs.length = 0;
    const budget = create_track_api_budget(1);
    await assert.rejects(spotify_api_call('GET', route, null, {
      skip_global_rate_limit_check: true, skip_global_rate_limit_persist: true,
      max_rate_retries: 0, track_api_budget: budget,
    }), err => err instanceof SpotifyRequestError && err.status === 429 && err.retry_after_sec === 120);
    assert.equal(budget.consumed(), route.startsWith('/tracks/') ? 1 : 0);
    assert.match(logs.join('\n'), /冷卻截止： 2026\/11\/02 23:32:13（台灣時間）/);
    assert.match(logs.join('\n'), /建議重新執行： 2026\/11\/02 23:33（台灣時間）/);
  }
  assert.equal(attempts, 2);
});

test('Windows ZIP 命名使用台灣時間與西元；重現舊版民國曆差異', { skip: process.platform !== 'win32' }, () => {
  const helper = fileURLToPath(new URL('../scripts/data-sync/taiwan-zip-name.ps1', import.meta.url));
  const script = `
    $ErrorActionPreference = 'Stop'
    . '${helper.replaceAll("'", "''")}'
    $instant = [DateTimeOffset]::Parse('2026-11-02T15:32:13Z', [Globalization.CultureInfo]::InvariantCulture)
    $roc = [Globalization.CultureInfo]::new('zh-TW')
    $roc.DateTimeFormat.Calendar = [Globalization.TaiwanCalendar]::new()
    [Threading.Thread]::CurrentThread.CurrentCulture = $roc
    'old=' + $instant.ToString('yyyyMMdd-HHmmss')
    Get-SpotifyHandoffFileName -Instant $instant
    foreach ($name in @('en-US','th-TH','ar-SA','ja-JP')) {
      [Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::new($name)
      Get-SpotifyHandoffFileName -Instant $instant
    }
    foreach ($value in @('2026-11-02T16:00:00Z','2026-11-30T16:00:00Z','2026-12-31T16:00:00Z')) {
      Get-SpotifyHandoffFileName -Instant ([DateTimeOffset]::Parse($value, [Globalization.CultureInfo]::InvariantCulture))
    }
  `;
  const child = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 0, child.stderr);
  const lines = child.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], 'old=1151102-153213');
  assert.deepEqual(lines.slice(1, 6), Array(5).fill('spotify-handoff-20261102-233213.zip'));
  assert.deepEqual(lines.slice(6), ['spotify-handoff-20261103-000000.zip',
    'spotify-handoff-20261201-000000.zip', 'spotify-handoff-20270101-000000.zip']);
});
