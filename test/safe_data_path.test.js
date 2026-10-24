/**
 * safe_data_path 單元測試（獨立暫存目錄）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolve_allowed_data_file_path,
  is_resolved_path_within_root,
} from '../lib/classification/manual_classify/safe_data_path.js';

function make_temp_dir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'so-safe-path-'));
}

test('1. 允許根內相對路徑', function () {
  const root = make_temp_dir();
  const allowed_root = path.join(root, 'backup');
  fs.mkdirSync(allowed_root, { recursive: true });
  const target = path.join(allowed_root, 'library', 'album-tracks.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '{}', 'utf8');
  const resolved = resolve_allowed_data_file_path(target, [allowed_root]);
  assert.equal(resolved, fs.realpathSync(target));
});

test('2. 拒絕根外絕對路徑', function () {
  const root = make_temp_dir();
  const allowed_root = path.join(root, 'data');
  fs.mkdirSync(allowed_root, { recursive: true });
  const outside = path.join(root, 'outside-secret.json');
  fs.writeFileSync(outside, '{}', 'utf8');
  assert.equal(resolve_allowed_data_file_path(outside, [allowed_root]), null);
});

test('3. 拒絕 .. 目錄穿越', function () {
  const root = make_temp_dir();
  const allowed_root = path.join(root, 'backup');
  fs.mkdirSync(allowed_root, { recursive: true });
  const secret = path.join(root, 'secret.json');
  fs.writeFileSync(secret, '{}', 'utf8');
  const traversal = path.join(allowed_root, '..', 'secret.json');
  assert.equal(resolve_allowed_data_file_path(traversal, [allowed_root]), null);
});

test('4. Windows 風格路徑邊界', function () {
  const root = make_temp_dir();
  const allowed_root = path.join(root, 'backup');
  fs.mkdirSync(allowed_root, { recursive: true });
  const inner = path.join(allowed_root, 'nested', 'file.json');
  fs.mkdirSync(path.dirname(inner), { recursive: true });
  fs.writeFileSync(inner, '{}', 'utf8');
  const win_style = inner.split('/').join('\\');
  const resolved = resolve_allowed_data_file_path(win_style, [allowed_root]);
  assert.ok(resolved);
  assert.equal(resolved, fs.realpathSync(inner));
});

test('5. 符號連結指向根外應拒絕', function () {
  if (process.platform === 'win32') {
    return;
  }
  const root = make_temp_dir();
  const allowed_root = path.join(root, 'backup');
  fs.mkdirSync(allowed_root, { recursive: true });
  const outside = path.join(root, 'outside-target.json');
  fs.writeFileSync(outside, '{"x":1}', 'utf8');
  const link_path = path.join(allowed_root, 'link.json');
  fs.symlinkSync(outside, link_path);
  assert.equal(resolve_allowed_data_file_path(link_path, [allowed_root]), null);
});

test('6. is_resolved_path_within_root', function () {
  const root = path.resolve('/tmp/example-root');
  assert.equal(is_resolved_path_within_root(root, root), true);
  assert.equal(
    is_resolved_path_within_root(path.join(root, 'a', 'b.json'), root),
    true
  );
  assert.equal(is_resolved_path_within_root(path.join(root, '..', 'etc'), root), false);
});
