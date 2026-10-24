/**
 * GUI 選檔耗時診斷（僅在 SO_GUI_PICK_TRACE 指向 TEMP 紀錄檔時啟用）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/** @type {RegExp[]} */
const TRACE_REDACT = [
  /password\s*[:=]\s*\S+/gi,
  /token\s*[:=]\s*\S+/gi,
  /Bearer\s+\S+/gi,
  /\.env\b/gi,
  /\.spotify_tokens\.json/gi,
];

/**
 * @param {string} text
 * @param {number} max_len
 */
function redact_trace_string(text, max_len) {
  let out = text.replace(/\r/g, '\n');
  for (let i = 0; i < TRACE_REDACT.length; i += 1) {
    out = out.replace(TRACE_REDACT[i], '[已省略]');
  }
  out = out.trim();
  if (out.length > max_len) {
    out = out.slice(0, max_len) + '…';
  }
  return out;
}

export const GUI_PICK_TRACE_ENV = 'SO_GUI_PICK_TRACE';
export const GUI_PICK_SKIP_INITIAL_ENV = 'SO_GUI_PICK_SKIP_INITIAL_DIR';
export const GUI_PICK_TRACE_LATEST_POINTER = 'so-gui-pick-trace-latest.txt';

/**
 * @returns {boolean}
 */
export function is_gui_pick_trace_enabled() {
  const p = process.env[GUI_PICK_TRACE_ENV];
  return typeof p === 'string' && p.trim() !== '';
}

/**
 * @returns {string}
 */
export function gui_pick_trace_file_path() {
  return (process.env[GUI_PICK_TRACE_ENV] || '').trim();
}

/**
 * @returns {boolean}
 */
export function should_skip_open_initial_directory() {
  return process.env[GUI_PICK_SKIP_INITIAL_ENV] === '1';
}

/**
 * @param {Record<string, unknown>} [detail]
 */
export function sanitize_trace_detail(detail) {
  if (!detail || typeof detail !== 'object') {
    return {};
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  const keys = Object.keys(detail);
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    let v = detail[k];
    if (typeof v === 'string') {
      v = redact_trace_string(v, 400);
    }
    out[k] = v;
  }
  return out;
}

/**
 * @param {string} phase
 * @param {Record<string, unknown>} [detail]
 * @param {'node' | 'vbs'} [layer]
 */
export function gui_pick_trace(phase, detail, layer) {
  const file = gui_pick_trace_file_path();
  if (!file) {
    return;
  }
  const row = {
    t: new Date().toISOString(),
    hr_ms: Math.round(performance.now()),
    pid: process.pid,
    layer: layer || 'node',
    phase: phase,
    ...sanitize_trace_detail(detail),
  };
  try {
    fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf8');
  } catch {
    /* */
  }
}

/**
 * @param {string} trace_file
 */
export function write_gui_pick_trace_pointer(trace_file) {
  try {
    const pointer = path.join(os.tmpdir(), GUI_PICK_TRACE_LATEST_POINTER);
    fs.writeFileSync(pointer, trace_file, 'utf8');
  } catch {
    /* */
  }
}

/**
 * @param {string} [temp_dir]
 * @param {Date} [when]
 */
export function build_gui_pick_trace_log_filename(temp_dir, when) {
  const d = when != null ? when : new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const stamp =
    String(d.getFullYear()) +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    '-' +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds());
  const base = 'so-gui-pick-trace-' + stamp + '.log';
  const dir = temp_dir != null ? temp_dir : os.tmpdir();
  return path.join(dir, base);
}

/**
 * @returns {{ ok: boolean, log_path?: string, reason?: string }}
 */
export function verify_gui_pick_trace_latest_pointer() {
  const pointer = path.join(os.tmpdir(), GUI_PICK_TRACE_LATEST_POINTER);
  if (!fs.existsSync(pointer)) {
    return { ok: false, reason: 'latest pointer missing' };
  }
  const log_path = fs.readFileSync(pointer, 'utf8').trim();
  if (!log_path) {
    return { ok: false, reason: 'latest pointer empty' };
  }
  if (!/^[A-Za-z]:\\/.test(log_path) && !log_path.startsWith('\\\\')) {
    return { ok: false, reason: 'log path not absolute' };
  }
  if (!fs.existsSync(log_path)) {
    return { ok: false, reason: 'log file not found', log_path: log_path };
  }
  const body = fs.readFileSync(log_path, 'utf8');
  if (!body.trim()) {
    return { ok: false, reason: 'log file empty', log_path: log_path };
  }
  return { ok: true, log_path: log_path };
}
