// 僅複製程式與指定測試；不讀取正式 Token、.env、備份或快取。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'so-token-suite-'));
try {
  fs.mkdirSync(path.join(temp, 'test/helpers'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.cpSync(path.join(root, 'lib'), path.join(temp, 'lib'), {
    recursive: true,
    filter: p => fs.lstatSync(p).isDirectory() || /\.(js|ps1)$/.test(p),
  });
  const tests = ['oauth_token_security.test.js', 'token_acl_isolated.test.js',
    'scopes.test.js', 'enrich_tracks.test.js', 'enrich_auto.test.js',
    'token_callers.test.js', 'enrich_status.test.js'];
  for (const name of ['server.js', 'enrich-status.js']) {
    fs.copyFileSync(path.join(root, name), path.join(temp, name));
  }
  for (const name of [...tests, 'helpers/offline_guard.cjs']) {
    fs.copyFileSync(path.join(root, 'test', name), path.join(temp, 'test', name));
  }
  // 舊補全測試需要曲庫與快取；完全合成，不讀取正式資料。
  fs.mkdirSync(path.join(temp, 'backup/merged'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'backup/enrichment'), { recursive: true });
  const index = {}, cache = {};
  for (let i = 0; i < 3400; i++) {
    const id = String(i).padStart(22, '0');
    index[id] = { spotify_id: id };
    if (i < 1200) cache[id] = { spotify_id: id, status: 'ok', name: 'Fake song',
      artists: [{ name: 'Fake artist' }], album: { name: 'Fake album' } };
  }
  fs.writeFileSync(path.join(temp, 'backup/merged/library-v2.json'), JSON.stringify({ schema_version: 2, track_index_by_spotify_id: index }));
  fs.writeFileSync(path.join(temp, 'backup/merged/merge-summary-v2.json'), '{"library_v2_merge_complete":true}');
  fs.writeFileSync(path.join(temp, 'backup/enrichment/track-metadata-cache.json'), JSON.stringify({ schema_version: 1, tracks_by_id: cache }));
  const r = spawnSync(process.execPath, ['--require', path.join(temp, 'test/helpers/offline_guard.cjs'),
    '--test', '--test-concurrency=1', ...tests.map(n => path.join(temp, 'test', n))], {
    cwd: temp, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, SPOTIFY_CLIENT_ID: 'fake-offline-client', SPOTIFY_TEST_FORMAL_ROOT: root },
  });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.error) console.error('Isolated test execution failed:', r.error.code);
  process.exitCode = r.status === 0 ? 0 : 1;
} finally {
  if (path.dirname(temp).toLowerCase() !== path.resolve(os.tmpdir()).toLowerCase() || !path.basename(temp).startsWith('so-token-suite-')) {
    throw new Error('Unsafe cleanup');
  }
  fs.rmSync(temp, { recursive: true, force: true });
  console.log('Token test temporary workspace cleaned:', !fs.existsSync(temp));
}
