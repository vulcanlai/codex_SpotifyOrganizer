/**
 * M3 OAuth 錯誤安全 + M4 Token 檔案權限（離線／mock）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('11. 敏感例外物件不進 OAuth 日誌字串', function () {
  const err = new Error(`refresh_token=${FAKE_REFRESH}`);
  err.response_body = { access_token: FAKE_ACCESS };
  const log_line = format_oauth_unexpected_error_log('Token refresh', err);
  assert.equal(oauth_message_contains_secret(log_line), false);
  assert.equal(log_line.indexOf(FAKE_ACCESS), -1);
  const display = oauth_error_for_user_display(err);
  assert.equal(oauth_message_contains_secret(display), false);
});
