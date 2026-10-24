/**
 * AI 分類測試流程
 */
import { test, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  select_ai_sample_track_ids,
  is_eligible_for_ai_sample,
} from '../lib/classification/ai_sample_select.js';
import { export_ai_test_sample, AiExportError } from '../lib/classification/ai_export.js';
import {
  validate_ai_candidates_doc,
  AiCandidatesValidationError,
} from '../lib/classification/ai_validate.js';
import { import_ai_candidates, AiImportError } from '../lib/classification/ai_import.js';
import { build_classification_index } from '../lib/classification/build_index.js';
import {
  load_manual_overrides,
  save_manual_overrides,
  upsert_track_override,
  empty_overrides_doc,
} from '../lib/classification/overrides_store.js';
import { handle_ai_classification_api } from '../lib/classification/ai_web_handlers.js';
import {
  FILE_CLASSIFICATION_INDEX,
  FILE_AI_SAMPLE,
} from '../lib/classification/paths.js';
import {
  snapshot_ai_v1_fixture,
  restore_ai_v1_fixture,
  ensure_ai_v1_canonical_test_fixture,
} from './helpers/ai_v1_snapshot.js';
import { FILE_LIBRARY_V2 } from '../lib/merge/v2/paths.js';
import { CONFIDENCE_CONFIRMED } from '../lib/classification/dimensions.js';

function load_index() {
  return JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8'));
}

function read_sample_doc() {
  return JSON.parse(fs.readFileSync(FILE_AI_SAMPLE, 'utf8'));
}

/** @type {ReturnType<typeof snapshot_ai_v1_fixture>|null} */
let ai_v1_fixture_snapshot = null;

before(function () {
  ensure_ai_v1_canonical_test_fixture();
  ai_v1_fixture_snapshot = snapshot_ai_v1_fixture();
});

afterEach(function () {
  restore_ai_v1_fixture(ai_v1_fixture_snapshot);
});

test('固定抽樣可重現', function () {
  const index = load_index();
  const a = select_ai_sample_track_ids(index.tracks_by_id, 30);
  const b = select_ai_sample_track_ids(index.tracks_by_id, 30);
  assert.deepEqual(a.selected_ids, b.selected_ids);
});

test('30 首 ID 不重複', function () {
  const index = load_index();
  const sel = select_ai_sample_track_ids(index.tracks_by_id, 30);
  assert.equal(sel.ok, true);
  assert.equal(new Set(sel.selected_ids).size, 30);
});

test('缺 metadata 不納入樣本', function () {
  assert.equal(
    is_eligible_for_ai_sample({ spotify_id: 'x', metadata_status: 'metadata_missing' }),
    false
  );
});

test('不足 30 首時安全失敗', function () {
  const fake = {};
  for (let i = 0; i < 10; i += 1) {
    fake['id' + i] = {
      spotify_id: 'id' + i,
      metadata_status: 'complete',
      display: { name: 'N' + i, artists: ['A'] },
      tags: [],
    };
  }
  const sel = select_ai_sample_track_ids(fake, 30);
  assert.equal(sel.ok, false);
  assert.throws(function () {
    export_ai_test_sample({ index_doc: { tracks_by_id: fake }, count: 30, write: false });
  }, AiExportError);
});

test('非法分類值與 confirmed 拒絕', function () {
  const sample = {
    track_count: 1,
    track_ids: ['abc'],
  };
  assert.throws(function () {
    validate_ai_candidates_doc(
      {
        schema_version: 1,
        candidates: [
          {
            spotify_id: 'abc',
            language: {
              value: '火星語',
              confidence: 'inferred',
              evidence: 'x',
              method: 'm',
              source: 's',
            },
          },
        ],
      },
      sample
    );
  }, AiCandidatesValidationError);

  assert.throws(function () {
    validate_ai_candidates_doc(
      {
        schema_version: 1,
        candidates: [
          {
            spotify_id: 'abc',
            language: {
              value: '未確認',
              confidence: CONFIDENCE_CONFIRMED,
              evidence: 'x',
              method: 'm',
              source: 's',
            },
          },
        ],
      },
      sample
    );
  }, AiCandidatesValidationError);
});

test('非樣本 ID 與重複 ID 拒絕', function () {
  const sample = { track_count: 1, track_ids: ['a'] };
  assert.throws(function () {
    validate_ai_candidates_doc(
      {
        schema_version: 1,
        candidates: [
          {
            spotify_id: 'b',
            language: {
              value: '未確認',
              confidence: 'unknown',
              evidence: 'e',
              method: 'm',
              source: 's',
            },
          },
        ],
      },
      sample
    );
  }, AiCandidatesValidationError);
});

test('候選匯入不改正式分類（無接受）', function () {
  const before = build_classification_index({ write: false });
  const sample = { sample_doc: read_sample_doc() };
  const candidates = build_minimal_candidates(sample.sample_doc);
  import_ai_candidates({
    write: true,
    sample_doc: sample.sample_doc,
    candidates_doc: candidates,
  });
  const after = build_classification_index({ write: false });
  assert.deepEqual(
    before.index_doc.tracks_by_id[sample.sample_doc.track_ids[0]].tags,
    after.index_doc.tracks_by_id[sample.sample_doc.track_ids[0]].tags
  );
});

test('接受候選後人工覆寫生效', async function () {
  const sample_doc = read_sample_doc();
  const id = sample_doc.track_ids[29];
  const candidates = build_minimal_candidates(sample_doc);
  import_ai_candidates({
    write: true,
    sample_doc: sample_doc,
    candidates_doc: candidates,
  });
  const res = await handle_ai_classification_api(
    'POST',
    '/api/ai/review',
    JSON.stringify({ spotify_id: id, action: 'accept', candidate_version: 1 }),
    new URLSearchParams()
  );
  assert.equal(res.status, 200);
  const ov = load_manual_overrides();
  assert.equal(ov.overrides_by_track_id[id].language, '未確認');
  const built = build_classification_index({ write: false });
  const langs = built.index_doc.tracks_by_id[id].tags.filter(function (t) {
    return t.dimension === 'language';
  });
  assert.ok(
    langs.some(function (t) {
      return t.is_manual_override === true && t.value === '未確認';
    })
  );
});

test('拒絕候選不套用', async function () {
  const sample_doc = read_sample_doc();
  const id = sample_doc.track_ids[28];
  import_ai_candidates({
    write: true,
    sample_doc: sample_doc,
    candidates_doc: build_minimal_candidates(sample_doc),
  });
  await handle_ai_classification_api(
    'POST',
    '/api/ai/review',
    JSON.stringify({ spotify_id: id, action: 'reject', candidate_version: 1 }),
    new URLSearchParams()
  );
  const ov = load_manual_overrides();
  assert.equal(ov.overrides_by_track_id[id], undefined);
});

test('既有人工覆寫優先於 AI 接受', async function () {
  const sample_doc = read_sample_doc();
  const id = sample_doc.track_ids[27];
  const ov = empty_overrides_doc();
  upsert_track_override(ov, id, { language: '台語', source: 'manual:user' });
  save_manual_overrides(ov);
  import_ai_candidates({
    write: true,
    sample_doc: sample_doc,
    candidates_doc: build_minimal_candidates(sample_doc),
  });
  const res = await handle_ai_classification_api(
    'POST',
    '/api/ai/review',
    JSON.stringify({ spotify_id: id, action: 'accept', candidate_version: 1 }),
    new URLSearchParams()
  );
  assert.equal(res.status, 409);
  upsert_track_override(ov, id, null);
  save_manual_overrides(ov);
});

test('來源 library-v2 未修改', function () {
  const before = fs.statSync(FILE_LIBRARY_V2).mtimeMs;
  export_ai_test_sample({ write: false, count: 5 });
  assert.equal(fs.statSync(FILE_LIBRARY_V2).mtimeMs, before);
});

function build_minimal_candidates(sample_doc) {
  const candidates = [];
  for (let i = 0; i < sample_doc.track_ids.length; i += 1) {
    const id = sample_doc.track_ids[i];
    candidates.push({
      spotify_id: id,
      language: {
        value: '未確認',
        confidence: 'unknown',
        evidence: '測試用最小候選',
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
    source: 'cursor_ai',
    sample_size: sample_doc.track_count,
    candidates,
  };
}
