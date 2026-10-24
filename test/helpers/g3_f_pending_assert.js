/**
 * G3-F dry reconcile：pending 與最新 wave remaining 對帳
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const WAVE_REMAINING_FILES = [
  path.join('backup', 'classification', 'g3-f7-wave-100', 'remaining-after-wave.json'),
  path.join('backup', 'classification', 'g3-f6-wave-100', 'remaining-after-wave.json'),
  path.join('backup', 'classification', 'g3-f5-wave-100', 'remaining-after-wave.json'),
  path.join('backup', 'classification', 'g3-f4-wave-100', 'remaining-after-wave.json'),
  path.join('backup', 'classification', 'g3-f3-wave-100', 'remaining-after-wave.json'),
  path.join('backup', 'classification', 'g3-f2-wave-100', 'remaining-after-wave.json'),
  path.join('backup', 'classification', 'g3-f1-wave-100', 'remaining-after-wave.json'),
];

/**
 * @returns {number|null}
 */
export function read_latest_f_wave_remaining_count() {
  const root = process.cwd();
  for (let i = 0; i < WAVE_REMAINING_FILES.length; i += 1) {
    const p = path.join(root, WAVE_REMAINING_FILES[i]);
    if (fs.existsSync(p)) {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (typeof doc.remaining_count === 'number') {
        return doc.remaining_count;
      }
    }
  }
  return null;
}

/**
 * @param {object} reconcile_result dry_run 回傳
 * @param {number} min_excluded_prior 至少排除的 prior F wave 曲目數
 */
export function assert_g3_f_dry_reconcile_pending(reconcile_result, min_excluded_prior) {
  const r = reconcile_result;
  assert.equal(r.reconciliation.universe.library_index_ids, 7759);
  assert.ok(r.queue.excluded_prior_f_wave_track_count >= min_excluded_prior);
  const remaining = read_latest_f_wave_remaining_count();
  if (remaining != null) {
    assert.equal(
      r.queue.pending_count,
      remaining,
      'pending 應與最新 F wave remaining-after-wave.json 一致'
    );
    return;
  }
  assert.ok(
    r.queue.pending_count === 1287 ||
      r.queue.pending_count === 1187 ||
      r.queue.pending_count === 1087,
    '無 remaining 錨點時 fallback 歷史 pending 值'
  );
}
