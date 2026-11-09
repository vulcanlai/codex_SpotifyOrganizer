/**
 * 分類 UI 版面結構（離線靜態檢查，非真實瀏覽器視覺）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html_path = path.join(root, 'public', 'classify', 'index.html');
const css_path = path.join(root, 'public', 'classify', 'app.css');
const js_path = path.join(root, 'public', 'classify', 'app.js');

test('index 含合併工作區與清單切換', function () {
  const html = fs.readFileSync(html_path, 'utf8');
  assert.match(html, /id="stats_cards"/);
  assert.match(html, /id="track_list"/);
  assert.match(html, /id="track_pagination"/);
  assert.match(html, /pagination_model\.js/);
  assert.match(html, /id="track_detail"/);
  assert.match(html, /id="tab_all"/);
  assert.match(html, /id="tab_ai"/);
  assert.match(html, /id="tab_quality"/);
  assert.match(html, /id="quality_audit_notice"/);
  assert.match(html, /id="btn_back_list"/);
  assert.match(html, /id="workspace"/);
  assert.match(html, /id="batch_toolbar"/);
  assert.match(html, /id="ai_test_batch"/);
  assert.match(html, /id="preview_panel"/);
  assert.match(html, /id="managed_playlists_panel"/);
  assert.doesNotMatch(html, /id="ai_track_list"/);
  assert.doesNotMatch(html, /id="ai_detail"/);
});

test('app.js 使用統一選曲與 dirty 確認', function () {
  const js = fs.readFileSync(js_path, 'utf8');
  assert.match(js, /confirm_leave_if_dirty/);
  assert.match(js, /override_form_dirty/);
  assert.match(js, /render_unified_detail/);
  assert.match(js, /\/api\/ai\/track\//);
  assert.match(js, /接受建議/);
  assert.match(js, /稍後審核/);
  assert.match(js, /detail_section_official/);
  assert.match(js, /detail_section_ai_review/);
  assert.match(js, /for="ai_ov_language"/);
  assert.match(js, /\/api\/ai\/batch-review/);
  assert.match(js, /run_playlist_preview/);
  assert.match(js, /ai_test_batch/);
  assert.match(js, /\/api\/quality-audit\//);
  assert.match(js, /load_quality_audit_tracks/);
  assert.match(js, /display_freeform/);
  assert.match(js, /format_confidence_tier/);
  assert.match(js, /page_size = 100/);
  assert.match(js, /page_by_mode = \{ all: 1, ai: 1, quality: 1 \}/);
  assert.match(js, /params\.set\('offset'/);
  assert.match(js, /pagination_pages/);
  assert.match(js, /page_by_mode\[list_mode\] = current_page/);
  assert.match(js, /current_page = page_by_mode\[mode\] \|\| 1/);
  assert.match(js, /mode === 'all'[\s\S]*run_search\(false\)/);
  assert.match(js, /clientWidth >= 520/);
  assert.match(js, /workspace_has_selection/);
  assert.match(js, /el_track_list\.scrollTop = 0/);
  assert.match(js, /locate_selected_in_client_list/);
  assert.match(js, /locate_track_id/);
  assert.match(js, /scroll_track_into_list/);
  assert.match(js, /search_request_gate/);
  assert.match(js, /requestAnimationFrame/);
  assert.match(js, /render_quality_track_list[\s\S]*btn\.className = 'track_list_btn'/);
  assert.match(js, /render_quality_track_list[\s\S]*title\.className = 'track_title'/);
  assert.match(js, /render_quality_track_list[\s\S]*sub\.className = 'track_sub'/);
});

test('CSS 定義 RWD 斷點', function () {
  const css = fs.readFileSync(css_path, 'utf8');
  assert.match(css, /@media \(min-width: 1200px\)/);
  assert.match(css, /@media \(min-width: 768px\) and \(max-width: 1199px\)/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /workspace_show_detail/);
  assert.match(css, /overflow-x: hidden/);
  assert.match(css, /\.form_stack/);
  assert.match(css, /--space_form_gap/);
  assert.match(css, /--track_row_min_height/);
  assert.match(css, /calc\(20 \* var\(--track_row_min_height\)/);
  assert.doesNotMatch(css, /@container \(max-width: 34rem\)/);
  assert.match(css, /workspace\.workspace_has_selection/);
  assert.match(css, /workspace\.workspace_has_selection \.track_list/);
  assert.match(css, /flex: 1 1 0/);
  assert.match(css, /height: 0/);
  assert.match(css, /max-height: none/);
  assert.match(css, /workspace\.workspace_has_selection \.pagination/);
  assert.match(css, /max-height: min\(65vh, 42rem\)/);
  assert.doesNotMatch(css, /\.track_list_item_active/);
});
