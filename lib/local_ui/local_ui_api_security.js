/**
 * 本機 Web UI API 安全（M1 連線 + M2 CSRF／Origin／Host）
 * 僅供 127.0.0.1 服務使用；不對外公開。
 */
import crypto from 'node:crypto';

/** @typedef {object} LocalUiApiSecurityState
 * @property {number} port
 * @property {number[]} extra_dev_origin_ports
 * @property {string} csrf_token
 */

/**
 * @param {string|null|undefined} remote_address
 */
export function is_local_loopback_address(remote_address) {
  const addr = remote_address || '';
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1'
  );
}

/**
 * @param {object} [config]
 * @returns {LocalUiApiSecurityState}
 */
export function create_local_ui_api_security_state(config) {
  const cfg = config || {};
  const port = Number(cfg.port);
  if (!port || port < 1 || port > 65535) {
    throw new Error('local_ui_api_security: invalid port');
  }
  /** @type {number[]} */
  const extra = [];
  const raw_extra = cfg.extra_dev_origin_ports || [];
  for (let i = 0; i < raw_extra.length; i += 1) {
    const p = Number(raw_extra[i]);
    if (p >= 1 && p <= 65535) {
      extra.push(p);
    }
  }
  return {
    port: port,
    extra_dev_origin_ports: extra,
    csrf_token: crypto.randomBytes(32).toString('hex'),
  };
}

/**
 * @param {string|null|undefined} host_header
 * @param {number} expected_port
 */
export function is_trusted_local_ui_host(host_header, expected_port) {
  if (!host_header || typeof host_header !== 'string') {
    return false;
  }
  const trimmed = host_header.trim().toLowerCase();
  if (!trimmed) {
    return false;
  }
  let hostname = trimmed;
  let port = null;
  if (trimmed.indexOf(']') >= 0) {
    return false;
  }
  const colon = trimmed.lastIndexOf(':');
  if (colon > 0 && /^\d+$/.test(trimmed.slice(colon + 1))) {
    hostname = trimmed.slice(0, colon);
    port = parseInt(trimmed.slice(colon + 1), 10);
  }
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    return false;
  }
  if (port !== null && port !== expected_port) {
    return false;
  }
  return true;
}

/**
 * @param {string|null|undefined} origin_header
 */
function parse_http_origin(origin_header) {
  if (origin_header === undefined || origin_header === null) {
    return { kind: 'missing', url: null };
  }
  const raw = String(origin_header).trim();
  if (!raw || raw.toLowerCase() === 'null') {
    return { kind: 'null', url: null };
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { kind: 'invalid', url: null };
    }
    return { kind: 'present', url: url };
  } catch {
    return { kind: 'invalid', url: null };
  }
}

/**
 * @param {URL} origin_url
 * @param {LocalUiApiSecurityState} state
 */
function is_allowed_browser_origin(origin_url, state) {
  const host = origin_url.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost') {
    return false;
  }
  let port = origin_url.port ? parseInt(origin_url.port, 10) : 80;
  if (origin_url.protocol === 'https:' && !origin_url.port) {
    port = 443;
  }
  if (port === state.port) {
    return true;
  }
  for (let i = 0; i < state.extra_dev_origin_ports.length; i += 1) {
    if (state.extra_dev_origin_ports[i] === port) {
      return true;
    }
  }
  return false;
}

function is_mutating_method(method) {
  const m = (method || 'GET').toUpperCase();
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
}

/**
 * @param {string|null|undefined} header_value
 * @param {LocalUiApiSecurityState} state
 */
export function csrf_header_matches(header_value, state) {
  const got = typeof header_value === 'string' ? header_value.trim() : '';
  if (!got || !state.csrf_token) {
    return false;
  }
  if (got.length !== state.csrf_token.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(state.csrf_token, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * @param {object} input
 * @param {string} input.method
 * @param {string} input.pathname
 * @param {Record<string, string|string[]|undefined>} [input.headers]
 * @param {string} [input.remote_address]
 * @param {LocalUiApiSecurityState} state
 */
export function evaluate_local_ui_api_guard(input, state) {
  const method = (input.method || 'GET').toUpperCase();
  const pathname = input.pathname || '/';
  const headers = input.headers || {};
  const remote = input.remote_address || '';

  if (!is_local_loopback_address(remote)) {
    return {
      ok: false,
      status: 403,
      error: 'forbidden_remote',
      message_zh: '僅允許本機連線',
    };
  }

  const host = headers.host || headers.Host || '';
  if (!is_trusted_local_ui_host(String(host), state.port)) {
    return {
      ok: false,
      status: 403,
      error: 'forbidden_host',
      message_zh: 'Host 非本機服務位址',
    };
  }

  const origin_parsed = parse_http_origin(headers.origin || headers.Origin);

  if (method === 'OPTIONS') {
    if (origin_parsed.kind !== 'present' || !is_allowed_browser_origin(origin_parsed.url, state)) {
      return {
        ok: false,
        status: 403,
        error: 'forbidden_origin',
        message_zh: 'Preflight 來源不被允許',
      };
    }
    const origin = origin_parsed.url.origin;
    return {
      ok: true,
      kind: 'preflight',
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Local-Ui-Csrf',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      },
    };
  }

  if (pathname === '/api/csrf' && method === 'GET') {
    return { ok: true, kind: 'csrf' };
  }

  if (is_mutating_method(method)) {
    if (origin_parsed.kind === 'null' || origin_parsed.kind === 'missing' || origin_parsed.kind === 'invalid') {
      return {
        ok: false,
        status: 403,
        error: 'forbidden_origin',
        message_zh: '寫入請求缺少可信 Origin',
      };
    }
    if (!is_allowed_browser_origin(origin_parsed.url, state)) {
      return {
        ok: false,
        status: 403,
        error: 'forbidden_origin',
        message_zh: '寫入請求來源不被允許',
      };
    }
    const csrf = headers['x-local-ui-csrf'] || headers['X-Local-Ui-Csrf'];
    if (!csrf_header_matches(typeof csrf === 'string' ? csrf : '', state)) {
      return {
        ok: false,
        status: 403,
        error: 'csrf_failed',
        message_zh: 'CSRF 驗證失敗',
      };
    }
  }

  return { ok: true, kind: 'continue' };
}

/**
 * @param {import('node:http').IncomingMessage} req
 */
export function incoming_headers_map(req) {
  /** @type {Record<string, string>} */
  const out = {};
  const raw = req.headers || {};
  const keys = Object.keys(raw);
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    const v = raw[k];
    if (typeof v === 'string') {
      out[k] = v;
    } else if (Array.isArray(v) && v.length) {
      out[k] = v[0];
    }
  }
  return out;
}

/** 測試用：覆寫 csrf token */
export function set_local_ui_csrf_token_for_tests(state, token) {
  state.csrf_token = token;
}

/**
 * 若已回應 HTTP 則回傳 true
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 * @param {LocalUiApiSecurityState} state
 */
export function apply_local_ui_api_guard_http(req, res, pathname, state) {
  const remote = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
  const guard = evaluate_local_ui_api_guard(
    {
      method: req.method || 'GET',
      pathname: pathname,
      headers: incoming_headers_map(req),
      remote_address: remote,
    },
    state
  );

  if (!guard.ok) {
    if (!res.headersSent) {
      res.writeHead(guard.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(
        JSON.stringify({
          error: guard.error,
          message_zh: guard.message_zh || null,
        })
      );
    }
    return true;
  }

  if (guard.kind === 'preflight') {
    if (!res.headersSent) {
      res.writeHead(guard.status, guard.headers);
      res.end();
    }
    return true;
  }

  if (guard.kind === 'csrf') {
    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ csrf_token: state.csrf_token }));
    }
    return true;
  }

  return false;
}
