/**
 * G3-F Agent 輸出封存與 validation 修正紀錄（不覆寫 original）
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../../atomic_json.js';

/**
 * 首次 ingest 時複製 Agent output 至 original 目錄（已存在則不覆寫）
 * @param {import('../g3_e/g3_e_wave_spec.js').G3EWaveSpec & { agent_outputs_original_dir?: string }} spec
 * @param {string} source_file_path
 */
export function archive_agent_output_once(spec, source_file_path) {
  if (!spec.agent_outputs_original_dir) {
    return { archived: false, reason: 'no_original_dir' };
  }
  const base = path.basename(source_file_path);
  const dest = path.join(spec.agent_outputs_original_dir, base);
  fs.mkdirSync(spec.agent_outputs_original_dir, { recursive: true });
  if (fs.existsSync(dest)) {
    return { archived: false, reason: 'already_exists', dest: dest };
  }
  fs.copyFileSync(source_file_path, dest);
  return { archived: true, dest: dest };
}

/**
 * @param {string} corrections_file
 */
export function init_validation_corrections_log(corrections_file) {
  if (fs.existsSync(corrections_file)) {
    return JSON.parse(fs.readFileSync(corrections_file, 'utf8'));
  }
  const doc = {
    schema_version: 1,
    correction_count: 0,
    corrections: [],
    note_zh: 'Agent 修正須另存 output；original 目錄不可覆寫',
  };
  write_json_atomic(corrections_file, doc);
  return doc;
}

/**
 * @param {string} corrections_file
 * @param {object} entry
 */
export function append_validation_correction(corrections_file, entry) {
  const doc = fs.existsSync(corrections_file)
    ? JSON.parse(fs.readFileSync(corrections_file, 'utf8'))
    : init_validation_corrections_log(corrections_file);
  doc.corrections.push(entry);
  doc.correction_count = doc.corrections.length;
  doc.last_updated_at = new Date().toISOString();
  write_json_atomic(corrections_file, doc);
  return doc;
}
