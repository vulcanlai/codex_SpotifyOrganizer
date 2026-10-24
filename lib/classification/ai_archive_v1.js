/**
 * 封存 v1 AI 候選與審核（不覆寫已存在封存）
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CLASSIFICATION_DIR,
  AI_TEST_V1_DIR,
  FILE_AI_CANDIDATES,
  FILE_AI_REVIEW,
  FILE_AI_CANDIDATES_V1,
  FILE_AI_REVIEW_V1,
  FILE_MANUAL_OVERRIDES,
} from './paths.js';

const V1_MANIFEST = 'archive-manifest.json';

/**
 * @returns {{ archived: boolean, copied: string[] }}
 */
export function archive_ai_v1_records() {
  if (!fs.existsSync(CLASSIFICATION_DIR)) {
    throw new Error('缺少 classification 目錄');
  }
  fs.mkdirSync(AI_TEST_V1_DIR, { recursive: true });

  const copied = [];
  const manifest_path = path.join(AI_TEST_V1_DIR, V1_MANIFEST);
  if (fs.existsSync(manifest_path)) {
    return { archived: false, copied: [], reason: 'v1 封存已存在' };
  }

  if (fs.existsSync(FILE_AI_CANDIDATES)) {
    fs.copyFileSync(FILE_AI_CANDIDATES, FILE_AI_CANDIDATES_V1);
    copied.push('ai-candidates.json');
  }
  if (fs.existsSync(FILE_AI_REVIEW)) {
    fs.copyFileSync(FILE_AI_REVIEW, FILE_AI_REVIEW_V1);
    copied.push('ai-review.json');
  }
  if (fs.existsSync(FILE_MANUAL_OVERRIDES)) {
    fs.copyFileSync(
      FILE_MANUAL_OVERRIDES,
      path.join(AI_TEST_V1_DIR, 'manual-overrides.snapshot.json')
    );
    copied.push('manual-overrides.snapshot.json');
  }

  const manifest = {
    archived_at: new Date().toISOString(),
    files: copied,
    note: 'v1 候選與審核封存；根目錄 ai-candidates.json / ai-review.json 仍為 v1 使用中副本',
  };
  fs.writeFileSync(manifest_path, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { archived: true, copied };
}
