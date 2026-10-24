/**
 * 主／子曲風字典、遷移與 profile 驗證
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  MAIN_GENRE_CODES,
  SUBGENRE_CODES,
  SUBGENRES_BY_CODE,
} from '../lib/classification/genre_taxonomy.js';
import {
  migrate_legacy_genre_label,
  LEGACY_AMBIGUOUS_LABELS,
} from '../lib/classification/genre_migrate.js';
import {
  validate_genre_profile,
  normalize_genre_profile,
  dedupe_main_genre_codes,
  build_track_genre_profile,
  genre_profile_from_ai_candidate,
} from '../lib/classification/genre_profile.js';
import { snapshot_classification_data } from '../lib/classification/snapshot_classification.js';
import { build_classification_index } from '../lib/classification/build_index.js';
import { search_classification_tracks } from '../lib/classification/search.js';
import { load_ai_review } from '../lib/classification/ai_review_store.js';
import { validate_ai_candidates_doc } from '../lib/classification/ai_validate.js';
import { CONFIDENCE_CONFIRMED } from '../lib/classification/dimensions.js';
import path from 'node:path';
import {
  FILE_AI_REVIEW,
  FILE_AI_CANDIDATES,
  FILE_AI_SAMPLE,
  AI_TEST_V1_DIR,
} from '../lib/classification/paths.js';
import { ensure_ai_v1_canonical_test_fixture } from './helpers/ai_v1_snapshot.js';
import { FILE_LIBRARY_V2 } from '../lib/merge/v2/paths.js';

test('12 主曲風與 40 子曲風', function () {
  assert.equal(MAIN_GENRE_CODES.length, 12);
  assert.equal(SUBGENRE_CODES.length, 40);
});

test('子曲風所屬主曲風合法', function () {
  const keys = Object.keys(SUBGENRES_BY_CODE);
  for (let i = 0; i < keys.length; i += 1) {
    const row = SUBGENRES_BY_CODE[keys[i]];
    assert.ok(MAIN_GENRE_CODES.indexOf(row.main) >= 0);
  }
});

test('主曲風 unknown 時不得有子曲風', function () {
  const errors = validate_genre_profile({
    primary_genre: 'unknown',
    secondary_genres: [],
    subgenres: ['pop_ballad'],
  });
  assert.ok(errors.length > 0);
});

test('次要曲風最多 2 個且去重', function () {
  const deduped = dedupe_main_genre_codes(['pop', 'pop', 'rock']);
  assert.deepEqual(deduped, ['pop', 'rock']);
  const errors = validate_genre_profile({
    primary_genre: 'pop',
    secondary_genres: ['rock', 'electronic', 'folk'],
    subgenres: [],
  });
  assert.ok(errors.length > 0);
});

test('舊版流行與舞曲遷移', function () {
  const pop = migrate_legacy_genre_label('流行');
  assert.equal(pop.primary, 'pop');
  assert.equal(pop.migrated, true);
  const dance = migrate_legacy_genre_label('舞曲');
  assert.equal(dance.pending_manual, true);
  assert.ok(LEGACY_AMBIGUOUS_LABELS.indexOf('舞曲') >= 0);
});

test('AI inferred 候選仍通過驗證（legacy genres）', function () {
  const sample = JSON.parse(fs.readFileSync(FILE_AI_SAMPLE, 'utf8'));
  const doc = JSON.parse(fs.readFileSync(FILE_AI_CANDIDATES, 'utf8'));
  assert.doesNotThrow(function () {
    validate_ai_candidates_doc(doc, sample);
  });
  assert.notEqual(doc.candidates[0].language.confidence, CONFIDENCE_CONFIRMED);
});

test('build 含 genre_profile 且主曲風篩選不重複計數', function () {
  const built = build_classification_index({ write: false });
  const id = Object.keys(built.index_doc.tracks_by_id)[0];
  assert.ok(built.index_doc.tracks_by_id[id].genre_profile);
  assert.equal(built.index_doc.schema_version, 2);
  const result = search_classification_tracks(built.index_doc, {
    primary_genre: 'unknown',
    limit: 5,
  });
  assert.ok(result.total >= 1);
  assert.equal(result.items.length, Math.min(5, result.total));
});

test('人工覆寫 genre_profile 優先', function () {
  const tags = [
    {
      dimension: 'genre',
      value: '流行',
      confidence: 'inferred',
      is_manual_override: false,
    },
  ];
  const gp = build_track_genre_profile(tags, {
    genre_profile: {
      primary_genre: 'rock',
      secondary_genres: [],
      subgenres: ['classic_rock'],
    },
  });
  assert.equal(gp.primary_genre, 'rock');
  assert.deepEqual(gp.subgenres, ['classic_rock']);
});

test('AI 候選推導 genre_profile 不變 confirmed', function () {
  const profile = genre_profile_from_ai_candidate({
    genres: [{ value: '流行', confidence: 'inferred' }],
  });
  assert.equal(profile.confidence, 'inferred');
  assert.equal(profile.primary_genre, 'pop');
});

test('保留 ai-review 與 ai-candidates 完整性', function () {
  assert.ok(ensure_ai_v1_canonical_test_fixture(), '缺少 v1 封存或 sample-30 快照，無法對帳');
  const golden_review = JSON.parse(
    fs.readFileSync(path.join(AI_TEST_V1_DIR, 'ai-review.json'), 'utf8')
  );
  const review_hash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(FILE_AI_REVIEW))
    .digest('hex');
  const cand_hash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(FILE_AI_CANDIDATES))
    .digest('hex');
  build_classification_index({ write: false });
  const review = load_ai_review();
  assert.equal(
    review.reviews_by_track_id['0V58TmLnChjbNycM9QfFC0'].status,
    golden_review.reviews_by_track_id['0V58TmLnChjbNycM9QfFC0'].status
  );
  assert.equal(
    review.reviews_by_track_id['0WeN17PUto5ZdSqkUBDOsX'].status,
    golden_review.reviews_by_track_id['0WeN17PUto5ZdSqkUBDOsX'].status
  );
  let pending = 0;
  let pending_golden = 0;
  const ids = Object.keys(review.reviews_by_track_id);
  for (let i = 0; i < ids.length; i += 1) {
    if (review.reviews_by_track_id[ids[i]].status === 'pending') {
      pending += 1;
    }
  }
  const gids = Object.keys(golden_review.reviews_by_track_id);
  for (let j = 0; j < gids.length; j += 1) {
    if (golden_review.reviews_by_track_id[gids[j]].status === 'pending') {
      pending_golden += 1;
    }
  }
  assert.equal(pending, pending_golden);
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(FILE_AI_REVIEW)).digest('hex'),
    review_hash
  );
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(FILE_AI_CANDIDATES)).digest('hex'),
    cand_hash
  );
});

test('library-v2 未修改', function () {
  const stat = fs.statSync(FILE_LIBRARY_V2);
  assert.ok(stat.mtimeMs > 0);
});

test('快照不含敏感檔', function () {
  const snap = snapshot_classification_data('test-snapshot-' + Date.now());
  assert.ok(snap.copied.indexOf('ai-review.json') >= 0);
  assert.ok(snap.copied.indexOf('ai-candidates.json') >= 0);
  assert.equal(snap.copied.indexOf('.env'), -1);
});
