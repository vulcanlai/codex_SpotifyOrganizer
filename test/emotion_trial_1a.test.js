/**
 * G3 情緒 Phase 1A 抽樣與證據盤點
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  shuffle_track_ids,
  select_emotion_trial_1a_sample,
  build_emotion_trial_1a_inventory,
  assess_emotion_evidence_readiness,
  EMOTION_READINESS_INSUFFICIENT,
} from '../lib/classification/g3_emotion/emotion_trial_sample.js';
import {
  inventory_rows_to_csv,
  summarize_inventory,
  run_emotion_trial_1a_export,
} from '../lib/classification/g3_emotion/emotion_trial_1a_export.js';
import {
  EMOTION_TRIAL_1A_SEED,
  EMOTION_TRIAL_1A_TOTAL,
  EMOTION_TRIAL_1A_COUNTS,
} from '../lib/classification/g3_emotion/emotion_trial_paths.js';
import { FILE_CLASSIFICATION_INDEX } from '../lib/classification/paths.js';
import { load_g3_f_adopt_registry } from '../lib/classification/g3_f/g3_f_adopt_registry_store.js';

function mini_index(ids, status_fn) {
  const tracks_by_id = {};
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    tracks_by_id[id] = {
      spotify_id: id,
      metadata_status: status_fn(id, i),
      display: {
        name: 'Title ' + id,
        artists: ['Artist'],
        album_name: 'Album',
      },
      genre_profile: { primary_genre: 'pop', source: 'test' },
      enrichment_cache_complete: false,
    };
  }
  return { tracks_by_id: tracks_by_id, track_count: ids.length };
}

test('shuffle 固定 seed 可重現', function () {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const s1 = shuffle_track_ids(ids, 'test-seed');
  const s2 = shuffle_track_ids(ids, 'test-seed');
  assert.deepEqual(s1, s2);
});

test('分層抽樣數量與互斥（合成索引）', function () {
  const high = [];
  for (let i = 0; i < 40; i += 1) {
    high.push('high' + i);
  }
  const complete = [];
  for (let i = 0; i < 40; i += 1) {
    complete.push('cmp' + i);
  }
  const missing = [];
  for (let i = 0; i < 25; i += 1) {
    missing.push('mis' + i);
  }
  const all_ids = high.concat(complete, missing);
  const index_doc = mini_index(all_ids, function (id) {
    if (id.indexOf('high') === 0 || id.indexOf('cmp') === 0) {
      return 'complete';
    }
    return 'metadata_missing';
  });
  const adoptions = {};
  for (let h = 0; h < high.length; h += 1) {
    adoptions[high[h]] = {
      status: 'adopted',
      confidence_tier: 'high',
      adopted_classification: { genre_profile: { primary_genre: 'pop' } },
    };
  }
  const registry_doc = { adoptions_by_track_id: adoptions };
  const sel = select_emotion_trial_1a_sample({
    seed: 'unit-test-seed',
    index_doc: index_doc,
    registry_doc: registry_doc,
  });
  assert.equal(sel.track_ids.length, EMOTION_TRIAL_1A_TOTAL);
  assert.equal(sel.strata.g3_f_high_genre.length, EMOTION_TRIAL_1A_COUNTS.g3_f_high_genre);
  assert.equal(
    sel.strata.metadata_complete_not_high.length,
    EMOTION_TRIAL_1A_COUNTS.metadata_complete_not_high
  );
  assert.equal(sel.strata.metadata_missing.length, EMOTION_TRIAL_1A_COUNTS.metadata_missing);
  const set = new Set(sel.track_ids);
  assert.equal(set.size, EMOTION_TRIAL_1A_TOTAL);
});

test('無音訊／歌詞時 evidence_insufficient', function () {
  const a = assess_emotion_evidence_readiness(
    { display: { name: 'Love Song', artists: ['A'] } },
    { spotify_id: 'x', status: 'ok', name: 'Love Song', artists: [{ name: 'A' }], album: { id: '1', name: 'Al' }, explicit: true, duration_ms: 200000 },
    null
  );
  assert.equal(a.emotion_readiness, EMOTION_READINESS_INSUFFICIENT);
  assert.equal(a.has_direct_audio_evidence, false);
  assert.equal(a.has_reliable_lyric_evidence, false);
});

test('真實索引 80 首抽樣可重現且分層正確', function () {
  if (!fs.existsSync(FILE_CLASSIFICATION_INDEX)) {
    return;
  }
  const a = select_emotion_trial_1a_sample({ seed: EMOTION_TRIAL_1A_SEED });
  const b = select_emotion_trial_1a_sample({ seed: EMOTION_TRIAL_1A_SEED });
  assert.deepEqual(a.track_ids, b.track_ids);
  assert.equal(a.track_ids.length, 80);
});

test('export dry-run 與 CSV 列數', function () {
  if (!fs.existsSync(FILE_CLASSIFICATION_INDEX)) {
    return;
  }
  const result = run_emotion_trial_1a_export({ write: false });
  assert.equal(result.rows.length, 80);
  const csv = inventory_rows_to_csv(result.rows);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 81);
  const sum = summarize_inventory(result.rows);
  assert.equal(sum.track_count, 80);
  assert.equal(
    sum.evidence_insufficient_count + sum.eligible_for_emotion_inference_count,
    80
  );
});
