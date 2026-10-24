/**
 * 匯入 GUI 繁體中文預覽文字
 */
import path from 'node:path';
import { CANONICAL_PROJECT_ROOT } from './constants.js';

/**
 * @param {object} preview
 * @param {string} project_root
 */
export function format_import_preview_zh(preview, project_root) {
  const zip_name = preview.zip_path
    ? path.basename(preview.zip_path)
    : '（未知）';
  const target = project_root || CANONICAL_PROJECT_ROOT;
  const handoff = preview.handoff || {};
  const allow =
    handoff.ok && handoff.allow_apply !== false ? '是' : '否';

  return [
    '=== SpotifyOrganizer 匯入預覽 ===',
    '',
    'ZIP 檔名：' + zip_name,
    '匯入目標：' + target,
    '檔案總數：' + preview.file_count,
    '預計新增：' + preview.would_add,
    '預計覆寫：' + preview.would_overwrite,
    '相同檔案：' + preview.identical,
    '衝突或異常：' + preview.conflict_or_anomaly,
    '交接情境：' + (handoff.scenario || '—') + '（' + (handoff.reason_zh || '') + '）',
    '是否允許繼續：' + allow,
    '',
    'bundle_id：' + (preview.bundle_id || '—'),
    'handoff 父 bundle：' + (preview.handoff_previous_bundle_id || '（無）'),
    '',
  ].join('\n');
}
