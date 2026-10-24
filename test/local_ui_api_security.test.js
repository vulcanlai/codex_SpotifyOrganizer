/**
 * M1/M2 本機 Web UI API 安全（獨立 port／不寫 backup）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  create_local_ui_api_security_state,
  evaluate_local_ui_api_guard,
  apply_local_ui_api_guard_http,
  is_local_loopback_address,
  is_trusted_local_ui_host,
  set_local_ui_csrf_token_for_tests,
} from '../lib/local_ui/local_ui_api_security.js';
import { handle_request } from '../manual-classify-ui-server.js';
import { handle_request as handle_classify_request } from '../classify-ui-server.js';
import { handle_request as handle_import_request } from '../import-ui-server.js';

function http_request(options, body) {
  return new Promise(function (resolve, reject) {
    const req = http.request(options, function (res) {
      const chunks = [];
      res.on('data', function (c) {
        chunks.push(c);
      });
      res.on('end', function () {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function start_ephemeral_server(request_handler) {
  return new Promise(function (resolve, reject) {
    const server = http.createServer(function (req, res) {
      request_handler(req, res).catch(function (e) {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(String(e && e.message ? e.message : e));
        }
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', function () {
      const addr = server.address();
      resolve({
        server: server,
        port: addr && typeof addr === 'object' ? addr.port : 0,
      });
    });
  });
}

test('1. loopback 位址辨識', function () {
  assert.equal(is_local_loopback_address('127.0.0.1'), true);
  assert.equal(is_local_loopback_address('::ffff:127.0.0.1'), true);
  assert.equal(is_local_loopback_address('8.8.8.8'), false);
});

test('2. 非本機 remote 拒絕（單元）', function () {
  const state = create_local_ui_api_security_state({ port: 8892, extra_dev_origin_ports: [5174] });
  const guard = evaluate_local_ui_api_guard(
    {
      method: 'GET',
      pathname: '/api/health',
      headers: { host: '127.0.0.1:8892' },
      remote_address: '10.0.0.5',
    },
    state
  );
  assert.equal(guard.ok, false);
  assert.equal(guard.error, 'forbidden_remote');
});

test('3. 不可信 Host 拒絕', function () {
  const state = create_local_ui_api_security_state({ port: 8891 });
  const guard = evaluate_local_ui_api_guard(
    {
      method: 'GET',
      pathname: '/api/csrf',
      headers: { host: 'evil.example:8891' },
      remote_address: '127.0.0.1',
    },
    state
  );
  assert.equal(guard.ok, false);
  assert.equal(guard.error, 'forbidden_host');
});

test('4. 外部 Origin POST 拒絕', function () {
  const state = create_local_ui_api_security_state({ port: 8892, extra_dev_origin_ports: [5174] });
  set_local_ui_csrf_token_for_tests(state, 'test_csrf_token_32bytes_hex_placeholder00');
  const guard = evaluate_local_ui_api_guard(
    {
      method: 'POST',
      pathname: '/api/preview',
      headers: {
        host: '127.0.0.1:8892',
        origin: 'https://evil.example',
        'x-local-ui-csrf': state.csrf_token,
      },
      remote_address: '127.0.0.1',
    },
    state
  );
  assert.equal(guard.ok, false);
  assert.equal(guard.error, 'forbidden_origin');
});

test('5. Origin null 拒絕', function () {
  const state = create_local_ui_api_security_state({ port: 8890 });
  set_local_ui_csrf_token_for_tests(state, 'abc');
  const guard = evaluate_local_ui_api_guard(
    {
      method: 'POST',
      pathname: '/api/import-batch',
      headers: { host: '127.0.0.1:8890', origin: 'null', 'x-local-ui-csrf': 'abc' },
      remote_address: '127.0.0.1',
    },
    state
  );
  assert.equal(guard.ok, false);
  assert.equal(guard.error, 'forbidden_origin');
});

test('6. 不可信 OPTIONS 拒絕', function () {
  const state = create_local_ui_api_security_state({ port: 8892, extra_dev_origin_ports: [5174] });
  const guard = evaluate_local_ui_api_guard(
    {
      method: 'OPTIONS',
      pathname: '/api/preview',
      headers: { host: '127.0.0.1:8892', origin: 'https://evil.example' },
      remote_address: '127.0.0.1',
    },
    state
  );
  assert.equal(guard.ok, false);
});

test('7. 合法同源 POST + CSRF', function () {
  const state = create_local_ui_api_security_state({ port: 8892, extra_dev_origin_ports: [5174] });
  const token = state.csrf_token;
  const guard = evaluate_local_ui_api_guard(
    {
      method: 'POST',
      pathname: '/api/preview',
      headers: {
        host: '127.0.0.1:8892',
        origin: 'http://127.0.0.1:8892',
        'x-local-ui-csrf': token,
      },
      remote_address: '127.0.0.1',
    },
    state
  );
  assert.equal(guard.ok, true);
});

test('8. Vite dev Origin 5174 允許（8892 後端）', function () {
  const state = create_local_ui_api_security_state({ port: 8892, extra_dev_origin_ports: [5174] });
  const guard = evaluate_local_ui_api_guard(
    {
      method: 'POST',
      pathname: '/api/preview',
      headers: {
        host: '127.0.0.1:8892',
        origin: 'http://127.0.0.1:5174',
        'x-local-ui-csrf': state.csrf_token,
      },
      remote_address: '127.0.0.1',
    },
    state
  );
  assert.equal(guard.ok, true);
});

test('9. 未授權 POST（缺 CSRF）拒絕', function () {
  const state = create_local_ui_api_security_state({ port: 8891 });
  const guard = evaluate_local_ui_api_guard(
    {
      method: 'POST',
      pathname: '/api/rebuild',
      headers: {
        host: '127.0.0.1:8891',
        origin: 'http://127.0.0.1:8891',
      },
      remote_address: '127.0.0.1',
    },
    state
  );
  assert.equal(guard.ok, false);
  assert.equal(guard.error, 'csrf_failed');
});

test('10. 8892 HTTP：GET /api/csrf 正常', async function () {
  const ep = await start_ephemeral_server(handle_request);
  try {
    const res = await http_request({
      host: '127.0.0.1',
      port: ep.port,
      path: '/api/csrf',
      method: 'GET',
      headers: { host: '127.0.0.1:8892' },
    });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.csrf_token && data.csrf_token.length >= 32);
  } finally {
    await new Promise(function (r) {
      ep.server.close(r);
    });
  }
});

test('11. 8891／8890 handle_request 可載入 CSRF', async function () {
  const ep1 = await start_ephemeral_server(handle_classify_request);
  const ep0 = await start_ephemeral_server(handle_import_request);
  try {
    const r1 = await http_request({
      host: '127.0.0.1',
      port: ep1.port,
      path: '/api/csrf',
      method: 'GET',
      headers: { host: '127.0.0.1:8891' },
    });
    assert.equal(r1.status, 200);
    const r0 = await http_request({
      host: '127.0.0.1',
      port: ep0.port,
      path: '/api/csrf',
      method: 'GET',
      headers: { host: '127.0.0.1:8890' },
    });
    assert.equal(r0.status, 200);
  } finally {
    await new Promise(function (r) {
      ep1.server.close(r);
    });
    await new Promise(function (r) {
      ep0.server.close(r);
    });
  }
});

test('12. is_trusted_local_ui_host 邊界', function () {
  assert.equal(is_trusted_local_ui_host('127.0.0.1:8892', 8892), true);
  assert.equal(is_trusted_local_ui_host('localhost:8892', 8892), true);
  assert.equal(is_trusted_local_ui_host('127.0.0.1:8891', 8892), false);
});
