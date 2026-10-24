/**
 * 人工分類本機 Web UI（Vue 建置靜態檔 + JSON API）
 * npm run manual:classify:ui
 * 僅監聽 127.0.0.1
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle_manual_classify_api } from './lib/classification/manual_classify/web_handlers.js';
import {
  create_local_ui_api_security_state,
  apply_local_ui_api_guard_http,
} from './lib/local_ui/local_ui_api_security.js';

export const MANUAL_CLASSIFY_UI_HOST = '127.0.0.1';
export const MANUAL_CLASSIFY_UI_PORT = 8892;

export const manual_classify_local_ui_security = create_local_ui_api_security_state({
  port: MANUAL_CLASSIFY_UI_PORT,
  extra_dev_origin_ports: [5174],
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public', 'manual-classify-ui');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function read_body(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on('data', function (chunk) {
      chunks.push(chunk);
    });
    req.on('end', function () {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function serve_static(pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel.indexOf('..') >= 0) {
    return null;
  }
  const file_path = path.join(PUBLIC_DIR, rel);
  if (!file_path.startsWith(PUBLIC_DIR)) {
    return null;
  }
  if (!fs.existsSync(file_path) || !fs.statSync(file_path).isFile()) {
    return null;
  }
  const ext = path.extname(file_path).toLowerCase();
  return {
    status: 200,
    headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' },
    body: fs.readFileSync(file_path),
  };
}

async function handle_request(req, res) {
  const url = new URL(req.url || '/', `http://${MANUAL_CLASSIFY_UI_HOST}:${MANUAL_CLASSIFY_UI_PORT}`);
  const pathname = url.pathname;
  const remote = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';

  if (pathname.indexOf('/api/') === 0) {
    if (apply_local_ui_api_guard_http(req, res, pathname, manual_classify_local_ui_security)) {
      return;
    }
    try {
      const body_text =
        req.method === 'POST' || req.method === 'PUT' ? await read_body(req) : '';
      const api_result = await handle_manual_classify_api(
        req.method || 'GET',
        pathname,
        body_text,
        { remote_address: remote }
      );
      if (api_result) {
        res.writeHead(api_result.status, api_result.headers);
        res.end(api_result.body);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: err && err.message ? err.message : 'Internal Server Error',
        })
      );
      return;
    }
  }

  const static_result = serve_static(pathname);
  if (static_result) {
    res.writeHead(static_result.status, static_result.headers);
    res.end(static_result.body);
    return;
  }

  if (pathname === '/' || pathname.indexOf('.') < 0) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<!DOCTYPE html><html lang="zh-Hant"><body><p>請先建置前端：<code>npm run manual:classify:ui:build</code></p></body></html>'
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

const server = http.createServer(function (req, res) {
  handle_request(req, res).catch(function (e) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    }
    console.error(e);
  });
});

const is_main =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (is_main) {
  server.listen(MANUAL_CLASSIFY_UI_PORT, MANUAL_CLASSIFY_UI_HOST, function () {
    console.log(
      '人工分類 Web UI：http://' + MANUAL_CLASSIFY_UI_HOST + ':' + MANUAL_CLASSIFY_UI_PORT
    );
    console.log('僅本機使用；Spotify 同步請使用 CLI（Web 未啟用寫入）。');
  });
}

export { server, handle_request };
