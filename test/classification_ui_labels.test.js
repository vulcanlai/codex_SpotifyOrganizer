/**
 * 分類 UI 中文標籤（不影響儲存代碼）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  format_decade_value,
  format_dimension_label,
  format_classification_value,
  format_confidence_label,
  format_review_status_label,
  dedupe_display_artists,
  format_filter_option_text,
  format_tag_line,
  format_confidence_tier,
  format_preview_mode,
  localize_freeform_text,
} from '../lib/classification/ui_labels.js';
import { taxonomy_export_for_ui } from '../lib/classification/genre_taxonomy.js';

test('年代代碼顯示為繁體中文、代碼本身不變', function () {
  assert.equal(format_decade_value('1990s'), '1990 年代');
  assert.equal(format_classification_value('decade', '1990s'), '1990 年代');
  assert.equal(format_classification_value('language', '國語'), '國語');
});

test('維度與可信度中文標籤', function () {
  assert.equal(format_dimension_label('genre'), '曲風');
  assert.equal(format_confidence_label('inferred'), 'AI 推測');
  assert.equal(format_confidence_label('unknown'), '資料不足');
  assert.equal(
    format_confidence_label('confirmed', { is_manual_override: true }),
    '人工確認'
  );
});

test('審核狀態中文標籤', function () {
  assert.equal(format_review_status_label('pending'), '待審核');
  assert.equal(format_review_status_label('accepted'), '已接受');
  assert.equal(format_review_status_label('rejected'), '已拒絕');
  assert.equal(format_review_status_label('modified'), '已修改');
});

test('篩選選項文字含中文、代碼可獨立使用', function () {
  const text = format_filter_option_text('decade', '2000s', 42);
  assert.equal(text, '2000 年代 (42)');
  assert.equal(format_filter_option_text('decade', '2000s').indexOf('2000'), 0);
});

test('藝人顯示層去重', function () {
  assert.deepEqual(dedupe_display_artists(['Harlem Yu', 'Harlem Yu']), ['Harlem Yu']);
  assert.deepEqual(
    dedupe_display_artists(['Jay Chou', 'jay chou', 'Jay Chou']),
    ['Jay Chou']
  );
});

test('標籤行顯示不替換儲存值', function () {
  const line = format_tag_line(
    {
      dimension: 'language',
      value: '英文',
      confidence: 'confirmed',
      is_manual_override: true,
    },
    'language'
  );
  assert.match(line, /語言：英文/);
  assert.match(line, /人工確認/);
});

test('可信度分級與預覽模式中文', function () {
  assert.equal(format_confidence_tier('high'), '高可信度');
  assert.equal(format_confidence_tier('low', { short: true }), '低');
  assert.equal(format_preview_mode('balanced'), '平衡（預設）');
});

test('自由文字僅替換已知代碼、保留歌名', function () {
  const tax = taxonomy_export_for_ui();
  const out = localize_freeform_text(
    '〈祝福〉metadata 不足；primary=pop_ballad，tier high',
    tax
  );
  assert.match(out, /祝福/);
  assert.doesNotMatch(out, /\bmetadata\b/i);
  assert.match(out, /抒情流行/);
});
