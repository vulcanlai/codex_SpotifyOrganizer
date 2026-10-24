/**
 * 正式中文 GUI 啟動 BAT（僅解析啟動命令，不開視窗）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const VBS_REL = 'scripts\\data-sync\\run-gui-launcher.vbs';
const START_TEMPLATE =
  'start "" /B wscript.exe //nologo "%~dp0' + VBS_REL + '"';

/**
 * @param {string} rel
 */
function read_bat(rel) {
  return fs.readFileSync(path.join(ROOT, rel));
}

/**
 * @param {Buffer} buf
 */
function assert_no_utf8_bom(buf) {
  assert.notDeepEqual(buf.slice(0, 3), Buffer.from([0xef, 0xbb, 0xbf]), 'UTF-8 BOM');
}

/**
 * @param {string} text
 */
function lines_ascii_only(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      continue;
    }
    assert.ok(
      /^[\x00-\x7F]*$/.test(line),
      'non-ASCII line: ' + line
    );
  }
}

/**
 * @param {string} text
 */
function extract_start_line(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (/^start\s/i.test(t)) {
      return t;
    }
  }
  return '';
}

/**
 * @param {string} start_line
 */
function parse_start_launcher(start_line) {
  assert.match(start_line, /^start\s/i);
  const m = start_line.match(
    /^start\s+""\s+\/B\s+wscript\.exe\s+\/\/nologo\s+"(%~dp0scripts\\data-sync\\run-gui-launcher\.vbs)"\s+(\S+)\s*$/i
  );
  assert.ok(m, 'start command shape: ' + start_line);
  return { vbs_placeholder: m[1], mode: m[2].toLowerCase() };
}

/**
 * @param {string} rel
 * @param {string} expected_mode
 * @param {{ allow_rem?: boolean }} [opts]
 */
function assert_formal_launcher_bat(rel, expected_mode, opts) {
  const buf = read_bat(rel);
  assert_no_utf8_bom(buf);
  const text = buf.toString('utf8');
  assert.match(text, /^@echo off/m);
  assert.match(text, /exit \/b 0\s*$/m);
  const start_line = extract_start_line(text);
  assert.equal(start_line, START_TEMPLATE + ' ' + expected_mode);
  const p = parse_start_launcher(start_line);
  assert.equal(p.mode, expected_mode);
  assert.equal(p.vbs_placeholder, '%~dp0scripts\\data-sync\\run-gui-launcher.vbs');
  const vbs_abs = path.join(ROOT, 'scripts', 'data-sync', 'run-gui-launcher.vbs');
  assert.equal(fs.existsSync(vbs_abs), true, 'launcher vbs missing');
  if (!opts || !opts.allow_rem) {
    lines_ascii_only(text);
  }
}

test('1. 匯入Spotify資料.bat 純 ASCII 與 import 模式', function () {
  assert_formal_launcher_bat('匯入Spotify資料.bat', 'import');
});

test('2. 模擬公司匯入測試.bat 純 ASCII 與 acceptance 模式', function () {
  assert_formal_launcher_bat('模擬公司匯入測試.bat', 'acceptance');
});

test('3. 匯出Spotify資料.bat 啟動 export（允許中文 REM）', function () {
  assert_formal_launcher_bat('匯出Spotify資料.bat', 'export', {
    allow_rem: true,
  });
  const text = read_bat('匯出Spotify資料.bat').toString('utf8');
  assert.match(text, /^REM /m);
});

test('4. 匯入 BAT 預期本體位元組', function () {
  const expected =
    '@echo off\n' +
    START_TEMPLATE +
    ' import\n' +
    'exit /b 0\n';
  const cn = read_bat('匯入Spotify資料.bat');
  assert.equal(cn.toString('utf8'), expected);
});
