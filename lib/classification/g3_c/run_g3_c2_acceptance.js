/**
 * G3-C.2 離線驗收寫入
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { load_unified_classification_view } from './build_unified_view.js';
import {
  analyze_sample_100_preview_gap,
  audit_classification_sources,
  run_smart_playlist_filter_smoke_tests,
  build_expansion_plan_1895,
  inventory_npm_test_script,
} from './g3_c2_acceptance.js';
import {
  G3_C2_DIR,
  FILE_G3_C2_PREVIEW_GAP,
  FILE_G3_C2_SOURCE_AUDIT,
  FILE_G3_C2_FILTER_TESTS,
  FILE_G3_C2_EXPANSION_PLAN,
  FILE_G3_C2_TEST_INVENTORY,
  FILE_G3_C2_OFFLINE_SUMMARY,
  G3_C2_SCHEMA_VERSION,
} from './paths_c2.js';

/**
 * @param {{ write?: boolean }} [opts]
 */
export function run_g3_c2_acceptance(opts) {
  const options = opts || {};
  const write = options.write !== false;
  const unified = load_unified_classification_view();
  if (!unified) {
    throw new Error('請先執行 g3:c1-build');
  }

  const gap = analyze_sample_100_preview_gap(unified);
  const audit = audit_classification_sources(unified);
  const filters = run_smart_playlist_filter_smoke_tests(unified);
  const expansion = build_expansion_plan_1895();
  const test_inv = inventory_npm_test_script();

  const summary = {
    schema_version: G3_C2_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    sample_100_in_balanced: gap.included_in_balanced_empty_filter,
    sample_100_excluded: gap.excluded_count,
    data_loss: gap.data_loss_detected,
    lemon_tree_conflict: audit.lemon_tree_conflict_preserved,
    filter_smoke_all_ok: filters.all_ok,
    needs_new_ai_1895: expansion.needs_new_cursor_ai,
    estimated_batches: expansion.batch_plan.estimated_batches,
    test_inventory: {
      npm_listed_files: test_inv.listed_file_count,
      not_in_npm: test_inv.not_in_npm_script,
    },
    summary_zh: [
      '10 首未進 balanced 預覽：皆為 AI confidence_tier=low 政策排除，非遺失',
      '待新 AI（有曲名）' + expansion.needs_new_cursor_ai + ' 首，約 ' + expansion.batch_plan.estimated_batches + ' 批',
    ],
  };

  if (write) {
    if (!fs.existsSync(G3_C2_DIR)) {
      fs.mkdirSync(G3_C2_DIR, { recursive: true });
    }
    write_json_atomic(FILE_G3_C2_PREVIEW_GAP, gap);
    write_json_atomic(FILE_G3_C2_SOURCE_AUDIT, audit);
    write_json_atomic(FILE_G3_C2_FILTER_TESTS, filters);
    write_json_atomic(FILE_G3_C2_EXPANSION_PLAN, expansion);
    write_json_atomic(FILE_G3_C2_TEST_INVENTORY, test_inv);
    write_json_atomic(FILE_G3_C2_OFFLINE_SUMMARY, summary);
  }

  return { summary: summary, gap: gap, audit: audit, expansion: expansion };
}
