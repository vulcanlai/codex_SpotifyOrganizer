/**
 * G3-D.4 170 首 Agent 推理與可回復採用方案
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { reconcile_d1_d3_d4 } from '../lib/classification/g3_d/g3_d4_reconcile.js';
import { run_g3_d4 } from '../lib/classification/g3_d/run_g3_d4.js';
import { load_g3_d4_agent_batches } from '../lib/classification/g3_d/g3_d4_load_agent_drafts.js';
import {
  FILE_G3_D4_ADOPT_OVERLAY,
  FILE_G3_D4_MERGED_CANDIDATE_200,
  FILE_G3_D4_PROGRESS,
  G3_D4_AGENT_SOURCE,
} from '../lib/classification/g3_d/paths_d4.js';
import { FILE_G3_D3_SAMPLE_30 } from '../lib/classification/g3_d/paths_d3.js';
import { build_unified_classification_view } from '../lib/classification/g3_c/build_unified_view.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../lib/enrichment/external/g1_sample.js';
import { compute_g3_unified_playlist_preview } from '../lib/classification/g3_c/g3_smart_playlist_preview.js';
import { PREVIEW_MODE_BALANCED } from '../lib/classification/preview_settings.js';

describe('G3-D.4', { concurrency: 1 }, function () {
  test('200 首對帳：30 D.3 + 170 D.4 無重複', function () {
    const r = reconcile_d1_d3_d4();
    assert.equal(r.ok, true);
    assert.equal(r.d1_total, 200);
    assert.equal(r.pending_total, 170);
    const d3 = JSON.parse(fs.readFileSync(FILE_G3_D3_SAMPLE_30, 'utf8'));
    const d3_ids = d3.tracks.map(function (t) {
      return t.track_id;
    });
    for (let i = 0; i < d3_ids.length; i += 1) {
      assert.ok(r.pending_track_ids.indexOf(d3_ids[i]) < 0, 'D.3 不得進 pending');
    }
    const union = d3_ids.concat(r.pending_track_ids);
    assert.equal(union.length, 200);
    const set = {};
    for (let j = 0; j < union.length; j += 1) {
      assert.ok(!set[union[j]], '重複 ID');
      set[union[j]] = true;
    }
  });

  test('170 首 Agent 草稿完成且非規則冒充', function () {
    const reconcile = reconcile_d1_d3_d4();
    const load = load_g3_d4_agent_batches(reconcile, { validate: true });
    assert.equal(load.success_count, 170);
    assert.equal(load.completed_batches, 17);
    for (let i = 0; i < load.tracks.length; i += 1) {
      assert.equal(load.tracks[i].source, G3_D4_AGENT_SOURCE);
      assert.notEqual(load.tracks[i].method, 'g3_d1_cursor_ai');
    }
  });

  test('200 首合併候選含 D.3 保留', function () {
    run_g3_d4({ write: true });
    const merged = JSON.parse(fs.readFileSync(FILE_G3_D4_MERGED_CANDIDATE_200, 'utf8'));
    assert.equal(merged.tracks.length, 200);
    assert.equal(merged.d3_count, 30);
    assert.equal(merged.d4_count, 170);
    const d3 = JSON.parse(fs.readFileSync(FILE_G3_D3_SAMPLE_30, 'utf8'));
    const sample_id = d3.tracks[0].track_id;
    const hit = merged.tracks.find(function (t) {
      return t.track_id === sample_id;
    });
    assert.equal(hit.source, 'cursor_agent_g3_d3_repair');
  });

  test('採用 overlay 未啟用且可指定 ID', function () {
    run_g3_d4({ write: true });
    const ov = JSON.parse(fs.readFileSync(FILE_G3_D4_ADOPT_OVERLAY, 'utf8'));
    assert.equal(ov.enabled, false);
    assert.equal(ov.adopt_track_ids.length, 200);
  });

  test('D.1 波次在 unified 顯示 rule_inference 非 Agent AI', function () {
    build_unified_classification_view({ write: false });
    const doc = build_unified_classification_view({ write: false }).doc;
    const sample = reconcile_d1_d3_d4();
    const tid = sample.d1_track_ids[0];
    const row = doc.tracks[tid];
    assert.ok(row);
    assert.equal(row.is_cursor_agent_ai, false);
    assert.equal(row.classification_display_tier, 'rule_inference');
    assert.equal(row.inference_source_kind.indexOf('rule'), 0);
  });

  test('Lemon Tree 衝突保留且 balanced 預覽不變', function () {
    const before = build_unified_classification_view({ write: false }).doc;
    const bal_before = compute_g3_unified_playlist_preview(
      PREVIEW_MODE_BALANCED,
      {},
      before
    );
    run_g3_d4({ write: true });
    const after = build_unified_classification_view({ write: false }).doc;
    const lemon = after.tracks[G1_MUST_INCLUDE_LEMON_TREE];
    assert.equal(lemon.auto_review_status, 'conflict');
    const bal_after = compute_g3_unified_playlist_preview(
      PREVIEW_MODE_BALANCED,
      {},
      after
    );
    assert.equal(bal_after.total, bal_before.total);
  });

  test('續跑進度檔存在', function () {
    assert.ok(fs.existsSync(FILE_G3_D4_PROGRESS));
    const p = JSON.parse(fs.readFileSync(FILE_G3_D4_PROGRESS, 'utf8'));
    assert.equal(p.agent_tracks_pending, 0);
  });
});
