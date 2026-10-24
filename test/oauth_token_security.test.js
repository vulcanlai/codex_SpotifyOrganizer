/**
 * M3 OAuth 錯誤安全 + M4 Token 檔案權限（離線／mock）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  OAuthTokenEndpointError,
  build_authorize_callback_user_message,
  format_oauth_console_detail,
  oauth_message_contains_secret,
  redact_oauth_secrets_in_text,
  sanitize_oauth_log_message,
  throw_token_endpoint_error,
  format_oauth_unexpected_error_log,
  oauth_error_for_user_display,
} from '../lib/auth/oauth_error_safety.js';
import {
  apply_token_file_protection,
  verify_token_file_protection,
} from '../lib/auth/token_file_permissions.js';
import { save_tokens_to_path } from '../lib/token_store.js';
import {
  exchange_code_for_tokens,
  refresh_access_token,
} from '../lib/spotify_auth.js';

const FAKE_REFRESH = 'fake_refresh_for_test_only';
const FAKE_ACCESS = 'BQAfake_access_token_value_for_leak_test_xxxxxxxx';

function with_mock_fetch(mock_fn, fn) {
  const prev = globalThis.fetch;
  globalThis.fetch = mock_fn;
  return Promise.resolve()
    .then(fn)
    .finally(function () {
      globalThis.fetch = prev;
    });
}

test('1. OAuth 授權回調失敗（access_denied）安全訊息', function () {
  const msg = build_authorize_callback_user_message(
    'access_denied',
    'User denied with secret refresh_token=evil'
  );
  assert.match(msg, /拒絕|取消/);
  assert.equal(oauth_message_contains_secret(msg), false);
});

test('2. Token Exchange 失敗不含原始 error_description', function () {
  try {
    throw_token_endpoint_error('token_exchange', 400, {
      error: 'invalid_grant',
      error_description: `leaked ${FAKE_ACCESS} refresh_token=abc`,
    });
    assert.fail('應拋錯');
  } catch (err) {
    assert.ok(err instanceof OAuthTokenEndpointError);
    assert.equal(err.http_status, 400);
    assert.equal(err.error_code, 'invalid_grant');
    assert.match(err.message, /重新/);
    assert.equal(oauth_message_contains_secret(err.message), false);
  }
});

test('3. Token Refresh 失敗（mock HTTP）', function () {
  return with_mock_fetch(
    async function () {
      return {
        ok: false,
        status: 400,
        text: async function () {
          return JSON.stringify({
            error: 'invalid_grant',
            error_description: `refresh_token=${FAKE_REFRESH}`,
          });
        },
      };
    },
    async function () {
      await assert.rejects(refresh_access_token(FAKE_REFRESH, { skip_save: true }), function (err) {
        assert.ok(err instanceof OAuthTokenEndpointError);
        assert.equal(err.phase, 'token_refresh');
        assert.equal(oauth_message_contains_secret(err.message), false);
        return true;
      });
    }
  );
});

test('4. 敏感 Body 不會出現在使用者錯誤訊息', function () {
  return with_mock_fetch(
    async function () {
      return {
        ok: false,
        status: 500,
        text: async function () {
          return `access_token=${FAKE_ACCESS}&refresh_token=${FAKE_REFRESH}`;
        },
      };
    },
    async function () {
      await assert.rejects(
        exchange_code_for_tokens('code', 'verifier', { skip_save: true }),
        function (err) {
          assert.ok(err instanceof OAuthTokenEndpointError);
          assert.equal(oauth_message_contains_secret(err.message), false);
          assert.equal(err.message.indexOf(FAKE_ACCESS), -1);
          return true;
        }
      );
    }
  );
});

test('5. Token 檔案建立與更新（暫存路徑）', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-token-'));
  const file = path.join(dir, 'tokens.json');
  try {
    save_tokens_to_path(
      file,
      {
        access_token: 'test_access',
        refresh_token: 'test_refresh',
        token_type: 'Bearer',
        expires_at: Date.now() + 3600000,
        scope: 'playlist-read-private',
      },
      process.platform === 'win32'
        ? undefined
        : { platform: 'linux' }
    );
    assert.equal(fs.existsSync(file), true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(parsed.access_token, 'test_access');
    save_tokens_to_path(
      file,
      {
        access_token: 'test_access_2',
        refresh_token: 'test_refresh',
        token_type: 'Bearer',
        expires_at: Date.now() + 3600000,
        scope: 'playlist-read-private',
      },
      process.platform === 'win32'
        ? undefined
        : { platform: 'linux' }
    );
    const parsed2 = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(parsed2.access_token, 'test_access_2');
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
    fs.rmdirSync(dir);
  }
});

const TEST_SID = 'S-1-5-21-9999999999-9999999999-9999999999';

test('6. Windows ACL 設定（SID grant + 事後 verify mock）', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-acl-'));
  const file = path.join(dir, 'tokens.json');
  fs.writeFileSync(file, '{}', 'utf8');
  try {
    const calls = [];
    const result = apply_token_file_protection(file, {
      platform: 'win32',
      resolve_windows_user_sid: function () {
        return TEST_SID;
      },
      spawnSync: function (cmd, args) {
        calls.push([cmd, args.slice()]);
        const is_icacls_read =
          cmd === 'icacls' &&
          !args.some(function (a) {
            return String(a).startsWith('/');
          });
        if (is_icacls_read) {
          return {
            status: 0,
            stdout: `*${TEST_SID}:(M)\nNT AUTHORITY\\SYSTEM:(F)\n`,
            stderr: '',
          };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.method, 'icacls');
    const grant_sid = calls.find(function (c) {
      return c[1] && String(c[1][2] || '').indexOf(`*${TEST_SID}:(M)`) >= 0;
    });
    assert.ok(grant_sid);
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});

test('7. ACL 第一步失敗（未改 inheritance）', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-acl-fail-'));
  const file = path.join(dir, 'tokens.json');
  fs.writeFileSync(file, '{}', 'utf8');
  try {
    const result = apply_token_file_protection(file, {
      platform: 'win32',
      resolve_windows_user_sid: function () {
        return TEST_SID;
      },
      spawnSync: function () {
        return { status: 1, stdout: '', stderr: 'Access denied' };
      },
    });
    assert.equal(result.ok, false);
    assert.ok(!result.partial_acl_applied);
    assert.ok(result.manual_hint_zh);
    assert.match(result.manual_hint_zh, /icacls/i);
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});

test('7b. ACL 部分成功後失敗會嘗試恢復繼承', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-acl-partial-'));
  const file = path.join(dir, 'tokens.json');
  fs.writeFileSync(file, '{}', 'utf8');
  try {
    let icacls_n = 0;
    const result = apply_token_file_protection(file, {
      platform: 'win32',
      resolve_windows_user_sid: function () {
        return TEST_SID;
      },
      spawnSync: function (cmd, args) {
        if (cmd !== 'icacls') {
          return { status: 0, stdout: '', stderr: '' };
        }
        icacls_n += 1;
        if (icacls_n === 1) {
          return { status: 0, stdout: '', stderr: '' };
        }
        if (args.indexOf('/inheritance:e') >= 0) {
          return { status: 0, stdout: '', stderr: '' };
        }
        return { status: 1, stdout: '', stderr: 'grant failed' };
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.partial_acl_applied, true);
    assert.equal(result.recovery_attempted, true);
    assert.match(result.warning || '', /無法確認/);
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});

test('8. Token Refresh 成功流程相容（mock，不寫正式 token 檔）', function () {
  return with_mock_fetch(
    async function () {
      return {
        ok: true,
        status: 200,
        text: async function () {
          return JSON.stringify({
            access_token: 'new_access_from_mock',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'playlist-read-private',
          });
        },
      };
    },
    async function () {
      const stored = await refresh_access_token(FAKE_REFRESH, { skip_save: true });
      assert.equal(stored.access_token, 'new_access_from_mock');
      assert.equal(stored.token_type, 'Bearer');
      assert.ok(stored.expires_at > Date.now());
    }
  );
});

test('9. sanitize 日誌與 console detail', function () {
  const dirty = `failed refresh_token=${FAKE_REFRESH}`;
  const clean = sanitize_oauth_log_message(dirty);
  assert.equal(oauth_message_contains_secret(clean), false);
  assert.equal(
    format_oauth_console_detail('Token refresh', 400, 'invalid_grant'),
    'Token refresh · HTTP 400 · invalid_grant'
  );
  const redacted = redact_oauth_secrets_in_text(`token ${FAKE_ACCESS} end`);
  assert.equal(redacted.indexOf(FAKE_ACCESS), -1);
});

test('10. verify 須含目前使用者 SID，且不因缺少 Everyone 即判安全', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-verify-'));
  const file = path.join(dir, 't.json');
  fs.writeFileSync(file, '{}', 'utf8');
  try {
    const v = verify_token_file_protection(file, {
      platform: 'win32',
      expected_windows_user_sid: TEST_SID,
      spawnSync: function () {
        return {
          status: 0,
          stdout: `*${TEST_SID}:(M)\nNT AUTHORITY\\SYSTEM:(F)\n`,
          stderr: '',
        };
      },
    });
    assert.equal(v.ok, true);
    const no_sid = verify_token_file_protection(file, {
      platform: 'win32',
      expected_windows_user_sid: TEST_SID,
      spawnSync: function () {
        return {
          status: 0,
          stdout: 'NT AUTHORITY\\SYSTEM:(F)\n',
          stderr: '',
        };
      },
    });
    assert.equal(no_sid.ok, false);
    assert.equal(no_sid.reason, 'cannot_confirm_safe');
    const bad = verify_token_file_protection(file, {
      platform: 'win32',
      expected_windows_user_sid: TEST_SID,
      spawnSync: function () {
        return {
          status: 0,
          stdout: `*${TEST_SID}:(M)\nEveryone:(F)\n`,
          stderr: '',
        };
      },
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'overly_broad_acl');
    const guest = verify_token_file_protection(file, {
      platform: 'win32',
      expected_windows_user_sid: TEST_SID,
      spawnSync: function () {
        return {
          status: 0,
          stdout: `*${TEST_SID}:(M)\nBUILTIN\\Guests:(R)\n`,
          stderr: '',
        };
      },
    });
    assert.equal(guest.ok, false);
    assert.equal(guest.reason, 'overly_broad_acl');
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});

test('11. 敏感例外物件不進 OAuth 日誌字串', function () {
  const err = new Error(`refresh_token=${FAKE_REFRESH}`);
  err.response_body = { access_token: FAKE_ACCESS };
  const log_line = format_oauth_unexpected_error_log('Token refresh', err);
  assert.equal(oauth_message_contains_secret(log_line), false);
  assert.equal(log_line.indexOf(FAKE_ACCESS), -1);
  const display = oauth_error_for_user_display(err);
  assert.equal(oauth_message_contains_secret(display), false);
});
