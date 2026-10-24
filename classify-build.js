/**
 * 建立智慧分類索引（唯讀來源 JSON）
 * npm run classify:build
 */
import {
  build_classification_index,
  print_classification_summary,
} from './lib/classification/build_index.js';

function main() {
  const result = build_classification_index();
  print_classification_summary(result.summary_doc);
}

main();
