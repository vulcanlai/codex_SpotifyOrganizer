// npm test 的隔離子程序專用；不修改 Windows 權限。
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const formal = path.resolve(process.env.SPOTIFY_TEST_FORMAL_ROOT).toLowerCase();
function check(p) {
  if (typeof p === 'number' || p == null) return;
  if (p instanceof URL) p = fileURLToPath(p);
  const resolved = path.resolve(String(p)).toLowerCase();
  if (resolved === formal || resolved.startsWith(formal + path.sep)) {
    throw new Error('Test forbidden from writing formal project: ' + resolved);
  }
}
for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'truncateSync', 'chmodSync', 'utimesSync']) {
  const original = fs[name];
  fs[name] = function (p, ...args) { check(p); return original.call(this, p, ...args); };
}
for (const name of ['renameSync', 'copyFileSync', 'cpSync']) {
  const original = fs[name];
  fs[name] = function (src, dest, ...args) {
    if (name === 'renameSync') check(src);
    check(dest);
    return original.call(this, src, dest, ...args);
  };
}
const open = fs.openSync;
fs.openSync = function (p, flags, ...args) {
  if (typeof flags === 'number' ? Boolean(flags & 0x243) : /[wa+]/.test(flags)) check(p);
  return open.call(this, p, flags, ...args);
};
const allowed = h => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(h);
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, ...args) {
  const u = new URL(input.url || String(input));
  if (!allowed(u.hostname)) throw new Error('Offline test blocked external fetch: ' + u.hostname);
  return originalFetch.call(this, input, ...args);
};
for (const name of ['node:http', 'node:https']) {
  const mod = require(name);
  for (const method of ['get', 'request']) {
    const original = mod[method];
    mod[method] = function (input, ...args) {
      const host = typeof input === 'string' || input instanceof URL
        ? new URL(input).hostname : (input.hostname || input.host || 'localhost');
      if (!allowed(host)) throw new Error('Offline test blocked external HTTP: ' + host);
      return original.call(this, input, ...args);
    };
  }
}
require('node:module').syncBuiltinESMExports();
