/**
 * 共用 OAuth 本機伺服器與「確保已授權」流程
 * 供 server.js、backup.js 使用，避免重複實作 PKCE callback
 */
import http from 'node:http';
import { URL } from 'node:url';
import {
  REDIRECT_HOST,
  REDIRECT_PORT,
} from './config.js';
import {
  build_authorize_url,
  create_auth_session,
  exchange_code_for_tokens,
  refresh_access_token,
} from './spotify_auth.js';
import {
  load_tokens,
  is_access_token_valid,
} from './token_store.js';
import { open_browser } from './open_browser.js';
import { get_missing_scopes } from './auth/scopes.js';

/** 進行中的 OAuth 工作階段（僅記憶體） */
let pending_auth = null;

let resolve_auth_flow;
/** @type {Promise<Error|null>} */
let auth_flow_done = create_auth_promise();

function create_auth_promise() {
  return new Promise(function (resolve) {
    resolve_auth_flow = resolve;
  });
}

function reset_auth_promise() {
  auth_flow_done = create_auth_promise();
}

function success_html() {
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-Hant">',
    '<head><meta charset="utf-8"><title>授權成功</title></head>',
    '<body>',
    '<p>Spotify 授權成功，您可以關閉此分頁並回到終端機。</p>',
    '</body></html>',
  ].join('');
}

function error_html(message) {
  const safe = String(message)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-Hant">',
    '<head><meta charset="utf-8"><title>授權失敗</title></head>',
    '<body>',
    `<p>授權失敗：${safe}</p>`,
    '</body></html>',
  ].join('');
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handle_callback_request(req, res) {
  const host = req.headers.host || `${REDIRECT_HOST}:${REDIRECT_PORT}`;
  let pathname;
  try {
    pathname = new URL(req.url || '/', `http://${host}`).pathname;
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  if (pathname !== '/callback') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  const full_url = new URL(req.url || '/', `http://${host}`);
  const error_param = full_url.searchParams.get('error');
  if (error_param) {
    const desc = full_url.searchParams.get('error_description') || error_param;
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(error_html(desc));
    console.error('\n[OAuth] Spotify 回傳錯誤：', desc);
    resolve_auth_flow(new Error(desc));
    return;
  }

  const code = full_url.searchParams.get('code');
  const state = full_url.searchParams.get('state');

  if (!pending_auth) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(error_html('沒有進行中的授權工作階段，請重新執行授權指令。'));
    resolve_auth_flow(new Error('missing pending auth session'));
    return;
  }

  if (!code || !state || state !== pending_auth.state) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(error_html('state 驗證失敗或缺少 authorization code。'));
    console.error('\n[OAuth] state 驗證失敗，請重新授權。');
    resolve_auth_flow(new Error('invalid state'));
    return;
  }

  const verifier = pending_auth.code_verifier;
  pending_auth = null;

  try {
    await exchange_code_for_tokens(code, verifier);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(success_html());
    console.log('\n[OAuth] 授權成功，已取得 token（內容未顯示於終端機）。');
    resolve_auth_flow(null);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(error_html(msg));
    console.error('\n[OAuth] Token 交換失敗：', msg);
    resolve_auth_flow(err instanceof Error ? err : new Error(msg));
  }
}

/**
 * 啟動僅含 /callback 的本機伺服器
 * @returns {Promise<import('node:http').Server>}
 */
export function start_oauth_server() {
  return new Promise(function (resolve, reject) {
    const server = http.createServer(function (req, res) {
      handle_callback_request(req, res).catch(function (e) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Internal Server Error');
        }
        console.error(e);
      });
    });

    server.on('error', reject);
    server.listen(REDIRECT_PORT, REDIRECT_HOST, function () {
      console.log(
        `本機 OAuth 伺服器：http://${REDIRECT_HOST}:${REDIRECT_PORT}/callback`
      );
      resolve(server);
    });
  });
}

/**
 * @param {import('node:http').Server} server
 */
export function stop_oauth_server(server) {
  return new Promise(function (resolve) {
    server.close(function () {
      resolve();
    });
  });
}

/**
 * 若 token 有效或 refresh 成功則略過瀏覽器；否則開啟授權 URL
 * @param {string[]} [required_scopes]
 */
export async function ensure_authorized(required_scopes) {
  reset_auth_promise();

  const required = required_scopes || [];
  const missing_scopes = get_missing_scopes(required);

  const existing = load_tokens();
  if (
    missing_scopes.length === 0 &&
    existing &&
    is_access_token_valid(existing)
  ) {
    console.log('[OAuth] 使用已保存且有效的 access token。');
    resolve_auth_flow(null);
    return;
  }

  if (
    missing_scopes.length === 0 &&
    existing &&
    existing.refresh_token
  ) {
    try {
      await refresh_access_token(existing.refresh_token);
      console.log('[OAuth] access token 已過期，已使用 refresh token 更新。');
      resolve_auth_flow(null);
      return;
    } catch (err) {
      console.warn(
        '[OAuth] refresh 失敗，將重新進行瀏覽器授權：',
        err.message || err
      );
    }
  }

  if (missing_scopes.length > 0) {
    console.log(
      '[OAuth] 目前 token 缺少權限：',
      missing_scopes.join(', ')
    );
    console.log(
      '[OAuth] 將開啟瀏覽器請您重新同意授權；在新授權成功前，不會覆寫既有 token 檔。'
    );
  }

  pending_auth = create_auth_session();
  const url = build_authorize_url(
    pending_auth.state,
    pending_auth.code_challenge,
    { show_dialog: missing_scopes.length > 0 }
  );

  console.log('\n請在瀏覽器開啟以下 Spotify 授權網址（或等待自動開啟）：\n');
  console.log(url);
  console.log('');

  await open_browser(url);
  console.log('已嘗試開啟預設瀏覽器。若未開啟，請手動複製上方網址。\n');

  const err = await auth_flow_done;
  if (err) {
    throw err;
  }
}

/**
 * 啟動 OAuth 伺服器 → 確保授權 → 執行 callback → 關閉伺服器
 * @param {() => Promise<void>} fn
 * @param {string[]} [required_scopes]
 */
export async function run_with_oauth(fn, required_scopes) {
  const server = await start_oauth_server();
  try {
    await ensure_authorized(required_scopes);
    await fn();
  } finally {
    await stop_oauth_server(server);
  }
}
