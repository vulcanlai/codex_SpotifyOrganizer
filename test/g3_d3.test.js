/**
 * G3-D.3 修復試驗
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { run_g3_d3_repair } from '../lib/classification/g3_d/run_g3_d3_repair.js';
import { build_d1_lineage_200 } from '../lib/classification/g3_d/g3_d3_lineage.js';
import { G3_D3_AGENT_REPAIR_TRACKS } from '../lib/classification/g3_d/g3_d3_agent_repair_drafts.js';
import {
  FILE_G3_D3_AGENT_DRAFTS_30,
  FILE_G3_D3_COMPARISON,
  FILE_G3_D3_SAMPLE_30,
  FILE_G3_D3_LINEAGE_200,
} from '../lib/classification/g3_d/paths_d3.js';
import { validate_g3_b_ai_draft } from '../lib/classification/g3_b/validate_ai_draft.js';
import { file_g3_evidence_index } from '../lib/classification/g3_evidence/paths.js';

describe('G3-D.3', { concurrency: 1 }, function () {
  test('D.1 200 首無 Cursor 逐首 AI', function () {
    const lin = build_d1_lineage_200();
    assert.equal(lin.counts.cursor_agent_actual_ai, 0);
    assert.ok(lin.counts.rule_fallback_unknown >= 70);
    assert.equal(lin.tracks.length, 200);
  });

  test('30 首樣本配額', function () {
    const r = run_g3_d3_repair({ write: true });
    const sample = JSON.parse(fs.readFileSync(FILE_G3_D3_SAMPLE_30, 'utf8'));
    assert.equal(sample.actual_total, 30);
    assert.equal(sample.shortfalls_zh.length, 0);
    const cohorts = {};
    for (let i = 0; i < sample.tracks.length; i += 1) {
      const c = sample.tracks[i].cohort;
      cohorts[c] = (cohorts[c] || 0) + 1;
    }
    assert.equal(cohorts.composer_only_soundtrack, 12);
    assert.equal(cohorts.unknown_or_low, 10);
    assert.equal(cohorts.needs_evidence_other_genre, 5);
    assert.equal(cohorts.quality_ok_control, 3);
    assert.ok(r.comparison.stats.unknown_improved >= 8);
  });

  test('Agent 草稿 30 首字典合法', function () {
    const ev = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks;
    const ids = G3_D3_AGENT_REPAIR_TRACKS.map(function (t) {
      return t.track_id;
    });
    validate_g3_b_ai_draft(
      { tracks: G3_D3_AGENT_REPAIR_TRACKS },
      { evidence_by_id: ev, allowed_track_ids: ids }
    );
    assert.equal(G3_D3_AGENT_REPAIR_TRACKS.length, 30);
    for (let j = 0; j < G3_D3_AGENT_REPAIR_TRACKS.length; j += 1) {
      assert.equal(G3_D3_AGENT_REPAIR_TRACKS[j].source, 'cursor_agent_g3_d3_repair');
    }
  });

  test('產物寫入且不覆寫 D.1 batch-drafts', function () {
    run_g3_d3_repair({ write: true });
    assert.ok(fs.existsSync(FILE_G3_D3_LINEAGE_200));
    assert.ok(fs.existsSync(FILE_G3_D3_AGENT_DRAFTS_30));
    assert.ok(fs.existsSync(FILE_G3_D3_COMPARISON));
    const comp = JSON.parse(fs.readFileSync(FILE_G3_D3_COMPARISON, 'utf8'));
    assert.equal(comp.sample_size, 30);
  });
});
