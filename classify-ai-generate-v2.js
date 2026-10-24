/**
 * npm run classify:ai-generate-v2
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  AI_TEST_V2_DIR,
  FILE_AI_SAMPLE,
  FILE_AI_CANDIDATES,
  FILE_AI_CANDIDATES_V2_DRAFT,
} from './lib/classification/paths.js';
import { build_v2_candidates_doc } from './lib/classification/ai_v2_compose.js';
import {
  normalize_ai_candidates_v2_doc,
  validate_ai_candidates_v2_doc,
} from './lib/classification/ai_validate.js';
import { write_json_atomic } from './lib/atomic_json.js';

function read_json(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const sample = read_json(FILE_AI_SAMPLE);
  const v1_path = fs.existsSync(FILE_AI_CANDIDATES)
    ? FILE_AI_CANDIDATES
    : path.join(path.dirname(FILE_AI_CANDIDATES), 'ai-test', 'ai-candidates.json');
  const v1 = read_json(v1_path);
  if (!v1) {
    console.error('找不到 v1 候選');
    process.exit(1);
  }
  const draft = build_v2_candidates_doc(sample, v1);
  const normalized = normalize_ai_candidates_v2_doc(draft);
  validate_ai_candidates_v2_doc(normalized, sample);
  fs.mkdirSync(AI_TEST_V2_DIR, { recursive: true });
  write_json_atomic(FILE_AI_CANDIDATES_V2_DRAFT, normalized);
  console.log('\n========== AI v2 候選草稿 ==========');
  console.log('寫入：', FILE_AI_CANDIDATES_V2_DRAFT);
  console.log('曲目數：', normalized.candidates.length);
  console.log('====================================\n');
}

main();
