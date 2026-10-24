/**
 * AI v2 候選：封存、匯入、比較、審核隔離
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FILE_AI_SAMPLE,
  FILE_AI_CANDIDATES,
  FILE_AI_REVIEW,
  FILE_AI_CANDIDATES_V2,
  FILE_AI_REVIEW_V2,
  AI_TEST_V1_DIR,
  AI_TEST_V2_DIR,
} from '../lib/classification/paths.js';
import { import_ai_candidates } from '../lib/classification/ai_import.js';
import { build_v2_candidates_doc } from '../lib/classification/ai_v2_compose.js';
import {
  normalize_ai_candidates_v2_doc,
  validate_ai_candidates_v2_doc,
} from '../lib/classification/ai_validate.js';
import { import_ai_candidates_v2 } from '../lib/classification/ai_import_v2.js';
import { load_ai_review, load_ai_review_at } from '../lib/classification/ai_review_store.js';
import { handle_ai_classification_api } from '../lib/classification/ai_web_handlers.js';
import { load_manual_overrides } from '../lib/classification/overrides_store.js';
import { compare_ai_candidate_docs } from '../lib/classification/ai_compare.js';
import { archive_ai_v1_records } from '../lib/classification/ai_archive_v1.js';
import { ensure_ai_v1_canonical_test_fixture } from './helpers/ai_v1_snapshot.js';

function read_json(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function build_minimal_v1(sample_doc) {
  const candidates = [];
  for (let i = 0; i < sample_doc.track_ids.length; i += 1) {
    candidates.push({
      spotify_id: sample_doc.track_ids[i],
      language: {
        value: '未確認',
        confidence: 'unknown',
        evidence: '測試',
        method: 'test',
        source: 'cursor_ai',
      },
      genres: [],
      moods: [],
      special_types: [],
    });
  }
  return {
    schema_version: 1,
    candidates,
    sample_size: sample_doc.track_count,
    sample_id: sample_doc.sample_id,
  };
}

test('v1 封存 manifest 存在', function () {
  archive_ai_v1_records();
  assert.ok(fs.existsSync(path.join(AI_TEST_V1_DIR, 'archive-manifest.json')));
  assert.ok(fs.existsSync(path.join(AI_TEST_V1_DIR, 'ai-candidates.json')));
  assert.ok(fs.existsSync(path.join(AI_TEST_V1_DIR, 'ai-review.json')));
});

test('v2 草稿 30 首 track id 與 sample 一致', function () {
  const sample = read_json(FILE_AI_SAMPLE);
  const v1 = read_json(FILE_AI_CANDIDATES);
  const draft = normalize_ai_candidates_v2_doc(build_v2_candidates_doc(sample, v1));
  validate_ai_candidates_v2_doc(draft, sample);
  const ids = draft.candidates.map(function (c) {
    return c.spotify_id;
  });
  assert.deepEqual(ids.sort(), sample.track_ids.slice().sort());
  assert.ok(draft.candidates.every(function (c) {
    return c.genre_profile && c.genre_profile.primary_genre;
  }));
});

test('v2 匯入 idempotent 且 v1 審核不變', async function () {
  assert.ok(ensure_ai_v1_canonical_test_fixture());
  const sample = read_json(FILE_AI_SAMPLE);
  const v1_before = read_json(FILE_AI_REVIEW);
  const accepted_id = '0WeN17PUto5ZdSqkUBDOsX';
  assert.equal(v1_before.reviews_by_track_id[accepted_id].status, 'accepted');

  const v1_doc = read_json(FILE_AI_CANDIDATES);
  const draft = normalize_ai_candidates_v2_doc(build_v2_candidates_doc(sample, v1_doc));
  const v2_before = load_ai_review_at(FILE_AI_REVIEW_V2);
  const pending_before = sample.track_ids.filter(function (id) {
    const rev = v2_before.reviews_by_track_id[id];
    return rev && rev.status === 'pending';
  }).length;

  const r1 = import_ai_candidates_v2({
    write: true,
    sample_doc: sample,
    candidates_doc: draft,
  });
  assert.equal(r1.candidates_doc.candidates.length, 30);
  const r2 = import_ai_candidates_v2({
    write: true,
    sample_doc: sample,
    candidates_doc: draft,
  });
  assert.equal(r2.idempotent, true);

  const v1_after = read_json(FILE_AI_REVIEW);
  assert.equal(v1_after.reviews_by_track_id[accepted_id].status, 'accepted');

  const v2_review = load_ai_review_at(FILE_AI_REVIEW_V2);
  const pending_count = sample.track_ids.filter(function (id) {
    return v2_review.reviews_by_track_id[id].status === 'pending';
  }).length;
  if (r1.imported) {
    assert.equal(pending_count, 30);
  } else {
    assert.equal(pending_count, pending_before);
  }
});

test('v2 拒絕不修改 manual-overrides', async function () {
  const sample = read_json(FILE_AI_SAMPLE);
  const id = sample.track_ids[0];
  const ov_before = load_manual_overrides();
  const res = await handle_ai_classification_api(
    'POST',
    '/api/ai/review',
    JSON.stringify({ spotify_id: id, action: 'reject', candidate_version: 2 }),
    new URLSearchParams()
  );
  assert.equal(res.status, 200);
  const ov_after = load_manual_overrides();
  assert.deepEqual(ov_after.overrides_by_track_id[id], ov_before.overrides_by_track_id[id]);
});

test('compare API 回傳 v1/v2 差異', async function () {
  const sample = read_json(FILE_AI_SAMPLE);
  const v1 = read_json(FILE_AI_CANDIDATES);
  const v2 = read_json(FILE_AI_CANDIDATES_V2);
  if (!v2) {
    return;
  }
  const summary = compare_ai_candidate_docs(v1, v2, sample.track_ids);
  assert.equal(summary.track_count, 30);
  const res = await handle_ai_classification_api(
    'GET',
    '/api/ai/compare',
    '',
    new URLSearchParams([['spotify_id', sample.track_ids[0]]])
  );
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.compare);
});
