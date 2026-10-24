/**
 * 追蹤歌單手動匯入 — 本機 Web UI
 * 僅監聽 127.0.0.1，不對外公開
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle_import_api } from './lib/import/web_handlers.js';
import {
  create_local_ui_api_security_state,
  apply_local_ui_api_guard_http,
} from './lib/local_ui/local_ui_api_security.js';

export const IMPORT_UI_HOST = '127.0.0.1';
export const IMPORT_UI_PORT = 8890;

export const import_local_ui_security = create_local_ui_api_security_state({
  port: IMPORT_UI_PORT,
  extra_dev_origin_ports: [],
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public', 'import');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
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
  const url = new URL(req.url || '/', `http://${IMPORT_UI_HOST}:${IMPORT_UI_PORT}`);
  const pathname = url.pathname;

  if (pathname.indexOf('/api/') === 0) {
    if (apply_local_ui_api_guard_http(req, res, pathname, import_local_ui_security)) {
      return;
    }
    try {
      const body_text =
        req.method === 'POST' || req.method === 'PUT'
          ? await read_body(req)
          : '';
      const api_result = await handle_import_api(
        req.method || 'GET',
        pathname,
        body_text
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
  server.listen(IMPORT_UI_PORT, IMPORT_UI_HOST, function () {
    console.log(`匯入 Web UI：http://${IMPORT_UI_HOST}:${IMPORT_UI_PORT}`);
    console.log('僅本機使用，請勿對外暴露此埠口。');
  });
}

export { server, handle_request };
