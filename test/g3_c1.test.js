/**
 * G3-C.1 統一檢視與智慧歌單預覽
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { run_g3_c1_build } from '../lib/classification/g3_c/run_g3_c1_build.js';
import { load_unified_classification_view } from '../lib/classification/g3_c/build_unified_view.js';
import { load_g3_b_ai_catalog } from '../lib/classification/g3_c/load_g3_b_ai_catalog.js';
import {
  FILE_G3_C1_UNIFIED_INDEX,
  FILE_G3_C1_FIELD_TASKS,
} from '../lib/classification/g3_c/paths_c1.js';
import { compute_g3_unified_playlist_preview } from '../lib/classification/g3_c/g3_smart_playlist_preview.js';
import { PREVIEW_MODE_BALANCED, PREVIEW_MODE_STRICT } from '../lib/classification/preview_settings.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../lib/enrichment/external/g1_sample.js';

describe('G3-C.1', { concurrency: 1 }, function () {
  test('建置統一檢視 7759 首無重複', function () {
    const r = run_g3_c1_build({ write: true });
    assert.ok(r.summary.track_count >= 7759);
    const doc = load_unified_classification_view();
    assert.ok(doc);
    const ids = Object.keys(doc.tracks);
    const set = {};
    for (let i = 0; i < ids.length; i += 1) {
      assert.ok(!set[ids[i]], '重複 ID');
      set[ids[i]] = true;
    }
    assert.equal(ids.length, doc.track_count);
  });

  test('100 首 AI 整合', function () {
    const catalog = load_g3_b_ai_catalog();
    assert.equal(catalog.sample_100_ids.length, 100);
    let n = 0;
    for (let i = 0; i < catalog.sample_100_ids.length; i += 1) {
      if (catalog.by_id[catalog.sample_100_ids[i]]) {
        n += 1;
      }
    }
    assert.equal(n, 100);
    const doc = load_unified_classification_view();
    assert.equal(doc.g3_ai_integrated_in_sample_100, 100);
  });

  test('Lemon Tree 衝突保留', function () {
    const doc = load_unified_classification_view();
    const lemon = doc.tracks[G1_MUST_INCLUDE_LEMON_TREE];
    assert.ok(lemon);
    assert.equal(lemon.auto_review_status, 'conflict');
    assert.ok(lemon.conflicts.length >= 1);
  });

  test('AI 不得變成 confirmed tier', function () {
    const doc = load_unified_classification_view();
    const catalog = load_g3_b_ai_catalog();
    const ids = Object.keys(catalog.by_id);
    for (let i = 0; i < ids.length; i += 1) {
      const v = doc.tracks[ids[i]];
      if (!v || !v.primary_genre) {
        continue;
      }
      if (v.primary_genre.source_tier === 'ai_suggestion') {
        assert.notEqual(v.primary_genre.confidence, 'confirmed');
      }
    }
  });

  test('needs_evidence 任務覆蓋大於 11', function () {
    assert.ok(fs.existsSync(FILE_G3_C1_FIELD_TASKS));
    const td = JSON.parse(fs.readFileSync(FILE_G3_C1_FIELD_TASKS, 'utf8'));
    assert.ok(td.task_count > 11);
    assert.equal(td.needs_evidence_track_count, 31);
  });

  test('G3 智慧歌單 strict 少於 balanced', function () {
    const doc = load_unified_classification_view();
    const strict = compute_g3_unified_playlist_preview(
      { primary_genre: 'pop' },
      PREVIEW_MODE_STRICT,
      doc
    );
    const balanced = compute_g3_unified_playlist_preview(
      { primary_genre: 'pop' },
      PREVIEW_MODE_BALANCED,
      doc
    );
    assert.ok(balanced.breakdown.total_unique >= strict.breakdown.total_unique);
  });

  test('統一索引檔存在', function () {
    assert.ok(fs.existsSync(FILE_G3_C1_UNIFIED_INDEX));
  });
});
