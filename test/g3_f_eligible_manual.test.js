/**
 * G3-F eligible 與 manual-overrides 維度相容
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compute_g3_f_eligible_candidates,
  select_g3_f_adopt_batch,
} from '../lib/classification/g3_f/g3_f_eligible.js';
import { manual_override_blocks_g3_f_genre_adopt } from '../lib/classification/g3_f/manual_override_adopt_guard.js';
import { build_classification_index } from '../lib/classification/build_index.js';
import { load_g3_f_adopt_registry } from '../lib/classification/g3_f/g3_f_adopt_registry_store.js';

function pick_high_tier_eligible_id() {
  const base = compute_g3_f_eligible_candidates();
  if (base.eligible.length > 0) {
    return base.eligible[0].track_id;
  }
  const sel = select_g3_f_adopt_batch({ batch_size: 1, batch_index: 0 });
  if (sel.batch.length > 0) {
    return sel.batch[0].track_id;
  }
  return null;
}

test('僅 MVP membership 不阻擋 G3-F 曲風 adopt 候選', function () {
  const id = pick_high_tier_eligible_id();
  assert.ok(id, '需要至少一筆 high tier staged 樣本');
  const overrides_doc = {
    schema_version: 1,
    overrides_by_track_id: {
      [id]: {
        source: 'test',
        mvp_playlist_ids: ['lg:v2:english:folk'],
      },
    },
  };
  assert.equal(manual_override_blocks_g3_f_genre_adopt(overrides_doc.overrides_by_track_id[id]), false);
  const computed = compute_g3_f_eligible_candidates({ overrides_doc: overrides_doc });
  const hit = computed.eligible.some(function (t) {
    return t.track_id === id;
  });
  assert.equal(hit, true);
});

test('僅 emotion membership 不阻擋 G3-F 曲風 adopt 候選', function () {
  const id = pick_high_tier_eligible_id();
  assert.ok(id);
  const overrides_doc = {
    schema_version: 1,
    overrides_by_track_id: {
      [id]: {
        source: 'test',
        emotion_playlist_ids: ['emotion:late_night_calm'],
        locked_dimensions: ['emotion_playlists', 'mvp_playlists'],
      },
    },
  };
  const computed = compute_g3_f_eligible_candidates({ overrides_doc: overrides_doc });
  assert.equal(
    computed.eligible.some(function (t) {
      return t.track_id === id;
    }),
    true
  );
});

test('僅語言人工指定不阻擋 G3-F 曲風 adopt 候選', function () {
  const id = pick_high_tier_eligible_id();
  assert.ok(id);
  const overrides_doc = {
    schema_version: 1,
    overrides_by_track_id: {
      [id]: { source: 'test', language: '英文' },
    },
  };
  const computed = compute_g3_f_eligible_candidates({ overrides_doc: overrides_doc });
  assert.equal(
    computed.eligible.some(function (t) {
      return t.track_id === id;
    }),
    true
  );
});

test('人工 genre_profile（舊版無 locked）仍阻擋 G3-F adopt', function () {
  const id = pick_high_tier_eligible_id();
  assert.ok(id);
  const overrides_doc = {
    schema_version: 1,
    overrides_by_track_id: {
      [id]: {
        source: 'test',
        genre_profile: {
          primary_genre: 'classical',
          secondary_genres: [],
          subgenres: [],
        },
      },
    },
  };
  assert.equal(manual_override_blocks_g3_f_genre_adopt(overrides_doc.overrides_by_track_id[id]), true);
  const computed = compute_g3_f_eligible_candidates({ overrides_doc: overrides_doc });
  assert.equal(
    computed.eligible.some(function (t) {
      return t.track_id === id;
    }),
    false
  );
});

test('已 adopted registry 筆數不因 eligible 計算而改變', function () {
  const before = load_g3_f_adopt_registry();
  const adopted_before = Object.keys(before.adoptions_by_track_id || {}).filter(function (id) {
    return before.adoptions_by_track_id[id].status === 'adopted';
  }).length;
  compute_g3_f_eligible_candidates({ registry_doc: before });
  const after = load_g3_f_adopt_registry();
  const adopted_after = Object.keys(after.adoptions_by_track_id || {}).filter(function (id) {
    return after.adoptions_by_track_id[id].status === 'adopted';
  }).length;
  assert.equal(adopted_before, adopted_after);
  build_classification_index({ write: false, g3_f_registry_doc: before });
});
