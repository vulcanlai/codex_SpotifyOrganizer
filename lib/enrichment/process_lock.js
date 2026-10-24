/**
 * enrichment 程序鎖（避免同時寫入快取）
 */
import fs from 'node:fs';
import os from 'node:os';
import { FILE_PROCESS_LOCK } from './paths.js';
import { ENRICHMENT_DIR } from './paths.js';

export class EnrichmentLockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EnrichmentLockError';
  }
}

/**
 * @param {number} pid
 */
export function is_process_alive(pid) {
  if (!pid || typeof pid !== 'number') {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object|null} lock_doc
 */
function is_lock_stale(lock_doc) {
  if (!lock_doc || typeof lock_doc.pid !== 'number') {
    return true;
  }
  return !is_process_alive(lock_doc.pid);
}

/**
 * @returns {{ release: () => void }}
 */
export function acquire_enrichment_lock(meta) {
  if (!fs.existsSync(ENRICHMENT_DIR)) {
    fs.mkdirSync(ENRICHMENT_DIR, { recursive: true });
  }

  if (fs.existsSync(FILE_PROCESS_LOCK)) {
    let existing = null;
    try {
      existing = JSON.parse(fs.readFileSync(FILE_PROCESS_LOCK, 'utf8'));
    } catch {
      existing = null;
    }
    if (!is_lock_stale(existing)) {
      throw new EnrichmentLockError(
        `已有 enrichment 程序執行中（pid=${existing.pid}）。請等待結束或確認該程序已停止。`
      );
    }
  }

  const lock_doc = {
    pid: process.pid,
    started_at: new Date().toISOString(),
    hostname: os.hostname(),
    meta: meta || null,
  };

  fs.writeFileSync(FILE_PROCESS_LOCK, `${JSON.stringify(lock_doc, null, 2)}\n`, {
    encoding: 'utf8',
  });

  let released = false;
  function release() {
    if (released) {
      return;
    }
    released = true;
    try {
      if (!fs.existsSync(FILE_PROCESS_LOCK)) {
        return;
      }
      const cur = JSON.parse(fs.readFileSync(FILE_PROCESS_LOCK, 'utf8'));
      if (cur && cur.pid === process.pid) {
        fs.unlinkSync(FILE_PROCESS_LOCK);
      }
    } catch {
      /* 保留鎖供人工檢查 */
    }
  }

  return { release, lock_doc };
}
