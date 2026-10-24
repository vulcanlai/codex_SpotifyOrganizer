/**
 * OAuth scope 離線測試
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parse_scope_string,
  configured_scopes,
} from '../lib/auth/scopes.js';
import { build_authorize_url } from '../lib/spotify_auth.js';
import { SCOPES } from '../lib/config.js';

test('parse_scope_string：空白與多重空格', function () {
  assert.deepEqual(parse_scope_string(''), []);
  assert.deepEqual(parse_scope_string('  a  b '), ['a', 'b']);
});

test('configured_scopes 含 user-follow-read', function () {
  const scopes = configured_scopes();
  assert.ok(scopes.indexOf('user-follow-read') >= 0);
  assert.ok(scopes.indexOf('user-library-read') >= 0);
});

test('SCOPES 字串含 user-follow-read', function () {
  assert.ok(SCOPES.indexOf('user-follow-read') >= 0);
});

test('SCOPES 含 MVP 私人歌單寫入', function () {
  assert.ok(SCOPES.indexOf('playlist-modify-private') >= 0);
});

test('build_authorize_url：show_dialog 追加參數', function () {
  const url = build_authorize_url('state1', 'challenge1', {
    show_dialog: true,
  });
  assert.ok(url.indexOf('show_dialog=true') >= 0);
  assert.ok(url.indexOf('user-follow-read') >= 0);
});

test('build_authorize_url：預設不含 show_dialog', function () {
  const url = build_authorize_url('state1', 'challenge1');
  assert.ok(url.indexOf('show_dialog=') < 0);
});

test('缺少 scope 判定邏輯', function () {
  const granted = parse_scope_string(
    'playlist-read-private user-library-read'
  );
  const required = ['user-follow-read'];
  const missing = required.filter(function (s) {
    return granted.indexOf(s) < 0;
  });
  assert.deepEqual(missing, ['user-follow-read']);
});
