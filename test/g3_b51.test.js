/**
 * G3-B.5.1 名稱覆蓋診斷
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { run_g3_b51_diagnostic } from '../lib/classification/g3_b/run_g3_b51_diagnostic.js';
import { run_title_coverage_diagnostic, has_valid_title } from '../lib/classification/g3_b/title_coverage_diagnostic.js';
import {
  FILE_B51_TITLE_COVERAGE,
  FILE_B51_EXCLUSION_COUNTS,
  FILE_B51_OFFLINE_SUMMARY,
} from '../lib/classification/g3_b/paths_b51.js';
import { FILE_CLASSIFICATION_INDEX } from '../lib/classification/paths.js';

describe('G3-B.5.1', { concurrency: 1 }, function () {
  test('7759 首排除原因可對帳', function () {
    const r = run_title_coverage_diagnostic({ write_index: false });
    const counts = r.exclusion_reason_counts.counts;
    const sum = Object.values(counts).reduce(function (a, b) {
      return a + b;
    }, 0);
    assert.equal(sum, r.coverage_summary.universe_spotify_ids);
    assert.equal(r.exclusion_reason_counts.sum_check, sum);
    assert.equal(r.coverage_summary.g3b5_sampling_pool_size, counts.in_g3b5_sampling_pool || 0);
  });

  test('抽樣池與排除計數一致（evidence 口徑）', function () {
    const r = run_title_coverage_diagnostic({ write_index: false });
    const pool = r.coverage_summary.g3b5_sampling_pool_size;
    assert.equal(pool, r.exclusion_reason_counts.counts.in_g3b5_sampling_pool || 0);
    assert.ok(
      r.coverage_summary.evidence_index_identity_has_title <=
        r.coverage_summary.at_least_one_source_has_title
    );
    assert.ok(pool <= r.coverage_summary.evidence_index_identity_has_title);
  });

  test('metadata_missing 與無 title 一致', function () {
    const r = run_title_coverage_diagnostic({ write_index: false });
    const u = r.coverage_summary.universe_spotify_ids;
    assert.equal(
      r.coverage_summary.all_sources_no_valid_title + r.coverage_summary.at_least_one_source_has_title,
      u
    );
    const index_doc = JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8'));
    const tracks = index_doc.tracks_by_id || {};
    let metadata_missing = 0;
    let complete_with_title = 0;
    const ids = Object.keys(tracks);
    for (let i = 0; i < ids.length; i += 1) {
      const row = tracks[ids[i]];
      if (row.metadata_status === 'metadata_missing') {
        metadata_missing += 1;
      }
      if (
        row.metadata_status === 'complete' &&
        row.display &&
        has_valid_title(row.display.name)
      ) {
        complete_with_title += 1;
      }
    }
    assert.equal(metadata_missing, r.coverage_summary.all_sources_no_valid_title);
    assert.equal(complete_with_title, r.coverage_summary.classification_index_display_has_title);
  });

  test('index 有 title 但 evidence 缺 title 可對帳', function () {
    const r = run_title_coverage_diagnostic({ write_index: false });
    const gap =
      r.coverage_summary.classification_index_display_has_title -
      r.coverage_summary.evidence_index_identity_has_title;
    assert.ok(gap >= 0);
    assert.equal(
      r.exclusion_reason_counts.counts.index_has_title_evidence_identity_missing || 0,
      gap
    );
  });

  test('離線寫入摘要', function () {
    run_g3_b51_diagnostic({ write: true });
    assert.ok(fs.existsSync(FILE_B51_OFFLINE_SUMMARY));
    const cov = JSON.parse(fs.readFileSync(FILE_B51_TITLE_COVERAGE, 'utf8'));
    const exc = JSON.parse(fs.readFileSync(FILE_B51_EXCLUSION_COUNTS, 'utf8'));
    assert.equal(cov.universe_spotify_ids, 7759);
    assert.ok(has_valid_title('x'));
    assert.equal(has_valid_title('  '), false);
    assert.equal(Object.keys(exc.counts).length > 0, true);
  });
});
