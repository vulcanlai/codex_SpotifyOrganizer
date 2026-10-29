import { create_g3_fixture } from './helpers/g3_fixture.js';
const fixture = create_g3_fixture();
/**
 * G3-B.5 百首樣本規劃（離線）
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
const { run_g3_b5_offline_plan } = await fixture.load("classification/g3_b/run_g3_b5_offline_plan.js");
const { load_g3_b_sample_from_g1 } = await fixture.load("classification/g3_b/sample.js");
const { validate_primary_subgenres } = await fixture.load("classification/g3_b/genre_subgenre_validate.js");
const { build_genre_dictionary_quality_report } = await fixture.load("classification/g3_b/genre_dictionary_report.js");
const { is_batch_completed, apply_batch_import_result } = await fixture.load("classification/g3_b/batch_plan.js");
const {
  FILE_G3_B5_SAMPLE_100,
  FILE_G3_B5_REUSE_30,
  FILE_G3_B5_NEW_70,
  G3_B5_SELECTION_SEED,
} = await fixture.load("classification/g3_b/paths_b5.js");
const { SUBGENRES_BY_CODE } = await fixture.load("classification/genre_taxonomy.js");

describe('G3-B.5', { concurrency: 1 }, function () {
  test('離線計畫：100 首無重複、30+70', function () {
    const r = run_g3_b5_offline_plan({ write: true });
    assert.equal(r.summary.total_tracks, 100);
    assert.equal(r.sample100.length, 100);
    const cohort = load_g3_b_sample_from_g1().track_ids;
    for (let i = 0; i < cohort.length; i += 1) {
      assert.ok(r.sample100.indexOf(cohort[i]) >= 0, '缺少 cohort30: ' + cohort[i]);
    }
    const set = {};
    for (let j = 0; j < r.sample100.length; j += 1) {
      assert.ok(!set[r.sample100[j]], '重複 ID');
      set[r.sample100[j]] = true;
    }
    assert.equal(r.summary.new_70, 70);
    assert.equal(r.summary.cohort_30, 30);
  });

  test('固定 seed 可重現 70 首', function () {
    const a = run_g3_b5_offline_plan({ write: false });
    const b = run_g3_b5_offline_plan({ write: false });
    const ids_a = a.sample100.filter(function (id) {
      return load_g3_b_sample_from_g1().track_ids.indexOf(id) < 0;
    });
    const ids_b = b.sample100.filter(function (id) {
      return load_g3_b_sample_from_g1().track_ids.indexOf(id) < 0;
    });
    assert.deepEqual(ids_a, ids_b);
    assert.equal(a.strat_report.seed, G3_B5_SELECTION_SEED);
  });

  test('30 首不列入新生成佇列', function () {
    const r = run_g3_b5_offline_plan({ write: false });
    const cohort = load_g3_b_sample_from_g1().track_ids;
    for (let i = 0; i < cohort.length; i += 1) {
      assert.ok(r.needs_gen_ids.indexOf(cohort[i]) < 0);
    }
    const cohort_rows = r.plan_tracks.filter(function (t) {
      return t.cohort === 'g3_b4_complete';
    });
    assert.equal(cohort_rows.length, 30);
    for (let c = 0; c < cohort_rows.length; c += 1) {
      assert.equal(cohort_rows[c].needs_new_generation, false);
    }
  });

  test('分類字典：folk_rock／pop_rock 合法 parent', function () {
    assert.equal(SUBGENRES_BY_CODE.folk_rock.main, 'folk');
    assert.equal(SUBGENRES_BY_CODE.pop_rock.main, 'rock');
    const bad_folk = validate_primary_subgenres('rock', ['folk_rock']);
    assert.equal(bad_folk.ok, false);
    const ok_folk = validate_primary_subgenres('folk', ['folk_rock']);
    assert.equal(ok_folk.ok, true);
    const bad_pop = validate_primary_subgenres('pop', ['pop_rock']);
    assert.equal(bad_pop.ok, false);
  });

  test('字典品質報告含 G3-B.4 事件', function () {
    const doc = build_genre_dictionary_quality_report();
    assert.equal(doc.dictionary_unchanged, true);
    assert.ok(doc.g3_b4_incidents.length >= 2);
    assert.ok(doc.main_to_allowed_subgenres.folk.indexOf('folk_rock') >= 0);
  });

  test('批次進度續跑與單批完成', function () {
    const r = run_g3_b5_offline_plan({ write: false });
    const plan = r.batch_plan;
    if (plan.batch_count === 0) {
      return;
    }
    let progress = {
      schema_version: 1,
      batches: plan.batches.map(function (b) {
        return {
          batch_id: b.batch_id,
          status: 'pending',
          imported_track_ids: [],
          failed: [],
          updated_at: null,
        };
      }),
      completed_batch_ids: [],
    };
    const first = plan.batches[0].batch_id;
    progress = apply_batch_import_result(progress, first, {
      batch_failed: false,
      imported_track_ids: plan.batches[0].track_ids,
      failed: [],
    });
    assert.equal(is_batch_completed(progress, first), true);
    progress = apply_batch_import_result(progress, first, {
      batch_failed: false,
      imported_track_ids: plan.batches[0].track_ids,
      failed: [],
    });
    assert.equal(is_batch_completed(progress, first), true);
  });

  test('產物檔案已寫入 g3-b5-trial-100', function () {
    run_g3_b5_offline_plan({ write: true });
    assert.ok(fs.existsSync(FILE_G3_B5_SAMPLE_100));
    assert.ok(fs.existsSync(FILE_G3_B5_REUSE_30));
    assert.ok(fs.existsSync(FILE_G3_B5_NEW_70));
    const sample = JSON.parse(fs.readFileSync(FILE_G3_B5_SAMPLE_100, 'utf8'));
    assert.equal(sample.track_ids.length, 100);
  });
});
