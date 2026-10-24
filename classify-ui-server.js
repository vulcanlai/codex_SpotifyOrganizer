/**
 * 智慧分類本機預覽 Web UI
 * npm run classify:ui
 * 僅監聽 127.0.0.1
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle_classification_api } from './lib/classification/web_handlers.js';

export const CLASSIFY_UI_HOST = '127.0.0.1';
export const CLASSIFY_UI_PORT = 8891;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public', 'classify');

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
  const url = new URL(req.url || '/', `http://${CLASSIFY_UI_HOST}:${CLASSIFY_UI_PORT}`);
  const pathname = url.pathname;

  if (pathname.indexOf('/api/') === 0) {
    try {
      const body_text =
        req.method === 'POST' || req.method === 'PUT'
          ? await read_body(req)
          : '';
      const api_result = await handle_classification_api(
        req.method || 'GET',
        pathname,
        body_text,
        url.searchParams
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
      const status = err && err.status ? err.status : 500;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
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
  server.listen(CLASSIFY_UI_PORT, CLASSIFY_UI_HOST, function () {
    console.log(`分類 Web UI：http://${CLASSIFY_UI_HOST}:${CLASSIFY_UI_PORT}`);
    console.log('僅本機使用，請勿對外暴露此埠口。');
  });
}

export { server, handle_request };
