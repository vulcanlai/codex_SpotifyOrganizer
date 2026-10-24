/**
 * UTF-8 JSON 原子寫入：先寫暫存檔再 rename，避免半成品
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} file_path - 最終檔案路徑
 * @param {unknown} data - 可 JSON 序列化的資料
 */
export function write_json_atomic(file_path, data) {
  const dir = path.dirname(file_path);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmp_path = `${file_path}.${process.pid}.tmp`;
  const json = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(tmp_path, json, { encoding: 'utf8' });
  fs.renameSync(tmp_path, file_path);
}
