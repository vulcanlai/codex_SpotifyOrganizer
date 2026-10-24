/**
 * 分類資料安全快照（不含 token / .env）
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CLASSIFICATION_DIR,
  FILE_CLASSIFICATION_INDEX,
  FILE_CLASSIFICATION_SUMMARY,
  FILE_MANUAL_OVERRIDES,
  FILE_AI_CANDIDATES,
  FILE_AI_REVIEW,
  FILE_AI_SAMPLE,
  FILE_AI_CANDIDATES_V2,
  FILE_AI_REVIEW_V2,
  FILE_CLASSIFICATION_SETTINGS,
  FILE_FORMAL_CLASSIFICATION_STATE,
  AI_TEST_V2_DIR,
} from './paths.js';

const SNAPSHOT_FILES = [
  FILE_CLASSIFICATION_INDEX,
  FILE_CLASSIFICATION_SUMMARY,
  FILE_MANUAL_OVERRIDES,
  FILE_AI_CANDIDATES,
  FILE_AI_REVIEW,
  FILE_AI_SAMPLE,
  FILE_AI_CANDIDATES_V2,
  FILE_AI_REVIEW_V2,
  FILE_CLASSIFICATION_SETTINGS,
  FILE_FORMAL_CLASSIFICATION_STATE,
];

/**
 * @param {string} [label]
 * @returns {{ dir: string, copied: string[] }}
 */
export function snapshot_classification_data(label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folder = label || `pre-genre-taxonomy-${stamp}`;
  const dir = path.join(CLASSIFICATION_DIR, 'snapshots', folder);
  fs.mkdirSync(dir, { recursive: true });
  const copied = [];
  for (let i = 0; i < SNAPSHOT_FILES.length; i += 1) {
    const src = SNAPSHOT_FILES[i];
    if (!fs.existsSync(src)) {
      continue;
    }
    const base = path.basename(src);
    fs.copyFileSync(src, path.join(dir, base));
    copied.push(base);
  }
  if (fs.existsSync(AI_TEST_V2_DIR)) {
    const v2_dir = path.join(dir, 'ai-test-v2');
    fs.mkdirSync(v2_dir, { recursive: true });
    const v2_names = fs.readdirSync(AI_TEST_V2_DIR);
    for (let v = 0; v < v2_names.length; v += 1) {
      const name = v2_names[v];
      const src = path.join(AI_TEST_V2_DIR, name);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, path.join(v2_dir, name));
        copied.push('ai-test-v2/' + name);
      }
    }
  }
  const manifest = {
    created_at: new Date().toISOString(),
    label: folder,
    files: copied,
  };
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );
  return { dir, copied };
}
