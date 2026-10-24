/**
 * Preview session 與 fingerprint 狀態（不寫正式 backup）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  issue_manual_classify_preview_token,
  validate_manual_classify_preview_token,
  preview_session_data_still_fresh,
  set_manual_classify_preview_token_ttl_ms_for_tests,
  restore_manual_classify_preview_token_ttl_ms_for_tests,
  reset_manual_classify_preview_sessions_for_tests,
} from '../lib/classification/manual_classify/manual_classify_preview_sessions.js';

const REQ = {
  spotify_input: '0000000000000000000099',
  spotify_id_kind: 'track',
  playlist_ids: ['lg:v2:english:folk'],
};

test('1. 偽造 token 拒絕', function () {
  reset_manual_classify_preview_sessions_for_tests();
  const fake =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const v = validate_manual_classify_preview_token(fake, REQ, 'fp1');
  assert.equal(v.ok, false);
  assert.equal(v.error, 'invalid_preview_token');
});

test('2. 缺少 overrides_fingerprint 拒絕', function () {
  reset_manual_classify_preview_sessions_for_tests();
  const token = issue_manual_classify_preview_token(REQ, 'fp1', 'reg1');
  const v = validate_manual_classify_preview_token(token, REQ, '');
  assert.equal(v.ok, false);
  assert.equal(v.error, 'missing_overrides_fingerprint');
});

test('3. G3 registry 變動 → stale_preview', function () {
  const session = {
    normalized_request: REQ,
    overrides_fingerprint: 'o1',
    g3_f_registry_fingerprint: 'r1',
    issued_at_ms: Date.now(),
    expires_at_ms: Date.now() + 60000,
    consumed: false,
  };
  const ok = preview_session_data_still_fresh(session, 'o1', 'r1');
  assert.equal(ok.ok, true);
  const stale = preview_session_data_still_fresh(session, 'o1', 'r2');
  assert.equal(stale.ok, false);
  assert.equal(stale.error, 'stale_preview');
});

test('4. token 過期', async function () {
  reset_manual_classify_preview_sessions_for_tests();
  set_manual_classify_preview_token_ttl_ms_for_tests(5);
  const token = issue_manual_classify_preview_token(REQ, 'fp1', 'reg1');
  await new Promise(function (resolve) {
    setTimeout(resolve, 15);
  });
  const v = validate_manual_classify_preview_token(token, REQ, 'fp1');
  assert.equal(v.ok, false);
  assert.equal(v.error, 'preview_token_expired');
  restore_manual_classify_preview_token_ttl_ms_for_tests();
});
