/**
 * G3-F wave 目錄掃描、狀態與下一波次解析（非執行次數推斷）
 */
import fs from 'node:fs';
import path from 'node:path';
import { CLASSIFICATION_DIR } from '../paths.js';
import { build_g3_f_paths, g3_f_wave_dir_name } from './g3_f_paths_dynamic.js';

/** G3-F 單波上限（目錄 wave-N 的 N） */
export const G3_F_WAVE_SIZE_MAX = 100;

/**
 * @param {number} requested
 * @param {number | null | undefined} pending_count
 */
export function clamp_g3_f_wave_size(requested, pending_count) {
  const r = requested || G3_F_WAVE_SIZE_MAX;
  if (r < 1 || r > G3_F_WAVE_SIZE_MAX) {
    throw new Error('wave_size 須為 1～' + G3_F_WAVE_SIZE_MAX + '，收到：' + r);
  }
  if (pending_count != null && pending_count >= 0) {
    return Math.min(r, pending_count);
  }
  return r;
}

/**
 * 讀取磁碟上 G3-F.N 對應的 wave 目錄大小（g3-fN-wave-S 的 S）
 * @param {number} wave_number
 * @returns {number | null}
 */
export function get_g3_f_wave_size_on_disk(wave_number) {
  if (!fs.existsSync(CLASSIFICATION_DIR)) {
    return null;
  }
  /** @type {number | null} */
  let found = null;
  const entries = fs.readdirSync(CLASSIFICATION_DIR);
  for (let i = 0; i < entries.length; i += 1) {
    const m = entries[i].match(/^g3-f(\d+)-wave-(\d+)$/);
    if (m && parseInt(m[1], 10) === wave_number) {
      const size = parseInt(m[2], 10);
      if (found != null && found !== size) {
        throw new Error(
          'G3-F.' + wave_number + ' 存在多個 wave 目錄大小（' + found + ' 與 ' + size + '）'
        );
      }
      found = size;
    }
  }
  return found;
}

/**
 * @returns {number[]}
 */
export function list_g3_f_wave_numbers_on_disk() {
  if (!fs.existsSync(CLASSIFICATION_DIR)) {
    return [];
  }
  /** @type {number[]} */
  const nums = [];
  const entries = fs.readdirSync(CLASSIFICATION_DIR);
  for (let i = 0; i < entries.length; i += 1) {
    const m = entries[i].match(/^g3-f(\d+)-wave-(\d+)$/);
    if (m) {
      nums.push(parseInt(m[1], 10));
    }
  }
  nums.sort(function (a, b) {
    return a - b;
  });
  return nums;
}

/**
 * @param {string} wave_dir
 * @param {number} expected_size
 */
export function is_g3_f_wave_staged_complete(wave_dir, expected_size) {
  const summary_p = path.join(wave_dir, 'offline-summary.json');
  if (fs.existsSync(summary_p)) {
    const summary = JSON.parse(fs.readFileSync(summary_p, 'utf8'));
    const target = summary.wave_track_count || expected_size;
    if (
      summary.staged_count >= target &&
      summary.validate_fail === 0 &&
      summary.halted !== true
    ) {
      return true;
    }
  }
  const staged_dir = path.join(wave_dir, 'staged-candidates');
  if (!fs.existsSync(staged_dir)) {
    return false;
  }
  const wave_file = path.join(wave_dir, 'wave-sample-' + expected_size + '.json');
  if (!fs.existsSync(wave_file)) {
    return false;
  }
  const wave = JSON.parse(fs.readFileSync(wave_file, 'utf8'));
  const staged_n = fs
    .readdirSync(staged_dir)
    .filter(function (f) {
      return f.endsWith('-staged.json');
    }).length;
  return staged_n >= (wave.track_count || 0) && wave.track_count > 0;
}

/**
 * @param {number} wave_number
 * @param {number} wave_size
 */
export function read_g3_f_wave_status(wave_number, wave_size) {
  const paths = build_g3_f_paths(wave_number, wave_size);
  const has_dir = fs.existsSync(paths.wave_dir);
  const has_sample = fs.existsSync(paths.file_wave);
  const staged_complete = has_dir && is_g3_f_wave_staged_complete(paths.wave_dir, wave_size);
  let manifest = null;
  if (fs.existsSync(paths.file_wave_manifest)) {
    manifest = JSON.parse(fs.readFileSync(paths.file_wave_manifest, 'utf8'));
  }
  return {
    wave_number: wave_number,
    wave_size: wave_size,
    wave_id: paths.wave_id,
    wave_dir: paths.wave_dir,
    has_dir: has_dir,
    has_sample: has_sample,
    staged_complete: staged_complete,
    manifest: manifest,
  };
}

/**
 * 解析下一個應操作的 F 波次：優先續跑「已 prepare 未完成 staged」者
 * @param {{ wave_size?: number, force_wave_number?: number | null }} [opts]
 */
export function resolve_next_g3_f_wave(opts) {
  const options = opts || {};
  const requested_size =
    options.requested_wave_size != null
      ? options.requested_wave_size
      : options.wave_size != null
        ? options.wave_size
        : G3_F_WAVE_SIZE_MAX;
  const pending_count = options.pending_count;

  if (options.force_wave_number != null) {
    const n = options.force_wave_number;
    const on_disk = get_g3_f_wave_size_on_disk(n);
    const size =
      on_disk != null ? on_disk : clamp_g3_f_wave_size(requested_size, pending_count);
    return {
      wave_number: n,
      wave_size: size,
      mode: 'forced',
      paths: build_g3_f_paths(n, size),
      reason_zh:
        on_disk != null
          ? '使用者指定 --wave=' + n + '（目錄 wave-' + on_disk + '）'
          : '使用者指定 --wave=' + n + '（新建 wave-' + size + '）',
    };
  }

  const nums = list_g3_f_wave_numbers_on_disk();
  /** @type {object[]} */
  const statuses = [];
  for (let i = 0; i < nums.length; i += 1) {
    const size_on_disk = get_g3_f_wave_size_on_disk(nums[i]);
    if (size_on_disk == null) {
      continue;
    }
    statuses.push(read_g3_f_wave_status(nums[i], size_on_disk));
  }

  for (let j = 0; j < statuses.length; j += 1) {
    const st = statuses[j];
    if (st.has_sample && !st.staged_complete) {
      return {
        wave_number: st.wave_number,
        wave_size: st.wave_size,
        mode: 'resume_incomplete',
        paths: build_g3_f_paths(st.wave_number, st.wave_size),
        reason_zh:
          '續跑 G3-F.' +
          st.wave_number +
          '（wave-' +
          st.wave_size +
          '，已有 wave sample，staged 未完成；不得跳號）',
        status: st,
      };
    }
  }

  let max_staged = 0;
  for (let k = 0; k < statuses.length; k += 1) {
    if (statuses[k].staged_complete && statuses[k].wave_number > max_staged) {
      max_staged = statuses[k].wave_number;
    }
  }
  const next = max_staged + 1;
  const new_size = clamp_g3_f_wave_size(requested_size, pending_count);
  return {
    wave_number: next,
    wave_size: new_size,
    mode: 'new_wave',
    paths: build_g3_f_paths(next, new_size),
    reason_zh:
      '新建 G3-F.' +
      next +
      ' wave-' +
      new_size +
      '（已完成 staged 最高波次 F.' +
      max_staged +
      '）',
    max_staged_complete: max_staged,
  };
}

/**
 * @param {object} paths build_g3_f_paths 結果
 * @param {object} extra
 */
export function write_g3_f_wave_manifest(paths, extra) {
  const doc = Object.assign(
    {
      schema_version: 1,
      wave_number: paths.wave_number,
      wave_id: paths.wave_id,
      wave_key: paths.wave_key,
      wave_size: paths.wave_size,
      seed: paths.wave_seed,
      updated_at: new Date().toISOString(),
    },
    extra || {}
  );
  fs.mkdirSync(paths.wave_dir, { recursive: true });
  fs.writeFileSync(paths.file_wave_manifest, JSON.stringify(doc, null, 2), 'utf8');
  return doc;
}

/**
 * 動態發現 wave-sample（供 prior 排除；含 F.7+）
 * @returns {{ wave_id: string, file: string, reason_zh: string }[]}
 */
export function discover_g3_f_wave_sample_entries() {
  /** @type {{ wave_id: string, file: string, reason_zh: string }[]} */
  const out = [];
  if (!fs.existsSync(CLASSIFICATION_DIR)) {
    return out;
  }
  const entries = fs.readdirSync(CLASSIFICATION_DIR);
  for (let i = 0; i < entries.length; i += 1) {
    const m = entries[i].match(/^g3-f(\d+)-wave-(\d+)$/);
    if (!m) {
      continue;
    }
    const n = parseInt(m[1], 10);
    const size = parseInt(m[2], 10);
    const dir_name = g3_f_wave_dir_name(n, size);
    const sample = path.join(CLASSIFICATION_DIR, dir_name, 'wave-sample-' + size + '.json');
    if (fs.existsSync(sample)) {
      out.push({
        wave_id: dir_name,
        file: sample,
        reason_zh: 'G3-F.' + n + ' wave-' + size + ' sample（目錄掃描）',
      });
    }
  }
  return out;
}
