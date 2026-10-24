/**
 * 讀取 gui-pick-only.js 寫入的選擇結果（階段 2）
 */
import fs from 'node:fs';

/**
 * @param {string} result_file
 */
export function read_gui_pick_result_file(result_file) {
  if (!result_file || !fs.existsSync(result_file)) {
    return { ok: false, reason_zh: '缺少檔案選擇結果' };
  }
  try {
    const doc = JSON.parse(fs.readFileSync(result_file, 'utf8'));
    if (!doc.ok || !doc.path) {
      return {
        ok: false,
        cancelled: doc.cancelled === true,
        reason_zh: doc.reason_zh || '檔案選擇未成功',
      };
    }
    return { ok: true, path: doc.path, mode: doc.mode };
  } catch (err) {
    return {
      ok: false,
      reason_zh:
        '無法讀取選擇結果：' +
        (err instanceof Error ? err.message : String(err)),
    };
  } finally {
    try {
      fs.unlinkSync(result_file);
    } catch {
      /* */
    }
  }
}
