/**
 * 原子發布 library-v2（失敗保留既有完整版）
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../../atomic_json.js';
import {
  FILE_LIBRARY_V2,
  FILE_MERGE_SUMMARY_V2,
  MERGED_DIR,
} from './paths.js';
import { run_build_library_v2 } from './build_library_v2.js';
import { MergeV2SourceError } from './validate_sources.js';

/**
 * @param {object} doc
 */
function is_complete_v2_summary(doc) {
  return (
    doc &&
    doc.schema_version === 2 &&
    doc.library_v2_merge_complete === true
  );
}

/**
 * @returns {object} merge_summary_v2
 */
export function publish_library_v2() {
  if (!fs.existsSync(MERGED_DIR)) {
    fs.mkdirSync(MERGED_DIR, { recursive: true });
  }

  let previous_complete = false;
  if (fs.existsSync(FILE_MERGE_SUMMARY_V2)) {
    try {
      const prev = JSON.parse(fs.readFileSync(FILE_MERGE_SUMMARY_V2, 'utf8'));
      previous_complete = is_complete_v2_summary(prev);
    } catch {
      previous_complete = false;
    }
  }

  let built;
  try {
    built = run_build_library_v2();
  } catch (err) {
    if (previous_complete) {
      throw new MergeV2SourceError(
        `合併失敗，已保留上一次完整的 library-v2：${err.message}`,
        err.details || []
      );
    }
    throw err;
  }

  const { library_v2_doc, merge_summary_v2 } = built;

  if (!merge_summary_v2.library_v2_merge_complete) {
    if (previous_complete) {
      throw new MergeV2SourceError(
        '完整性旗標未通過，未覆寫既有 library-v2.json。'
      );
    }
    throw new MergeV2SourceError('完整性旗標未通過，未寫入 library-v2。');
  }

  const tmp_v2 = `${FILE_LIBRARY_V2}.${process.pid}.staging`;
  const tmp_sum = `${FILE_MERGE_SUMMARY_V2}.${process.pid}.staging`;

  write_json_atomic(tmp_v2, library_v2_doc);
  write_json_atomic(tmp_sum, merge_summary_v2);

  fs.renameSync(tmp_v2, FILE_LIBRARY_V2);
  fs.renameSync(tmp_sum, FILE_MERGE_SUMMARY_V2);

  return merge_summary_v2;
}
