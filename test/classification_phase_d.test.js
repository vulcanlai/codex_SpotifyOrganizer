/**
 * 第六階段 D：狀態、可信度、預覽模式、批次審核（離線）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { build_classification_index } from '../lib/classification/build_index.js';
import { build_formal_classification_state } from '../lib/classification/formal_state_build.js';
import {
  resolve_formal_classification_state,
  FORMAL_CONFIRMED,
  FORMAL_AI_SUGGESTED,
  FORMAL_UNKNOWN,
  FORMAL_REJECTED,
} from '../lib/classification/classification_state.js';
import {
  compute_confidence_tier,
  TIER_LOW,
  TIER_MEDIUM,
  TIER_HIGH,
  primary_evidence_anchors_track,
} from '../lib/classification/confidence_tier.js';
import {
  evaluate_preview_inclusion,
} from '../lib/classification/preview_mode.js';
import {
  PREVIEW_MODE_STRICT,
  PREVIEW_MODE_BALANCED,
  PREVIEW_MODE_RELAXED,
} from '../lib/classification/preview_settings.js';
import {
  compute_smart_playlist_preview,
  compare_preview_modes,
} from '../lib/classification/smart_playlist_preview.js';
import { plan_batch_review, execute_batch_review } from '../lib/classification/ai_batch_review.js';
import { handle_classification_api } from '../lib/classification/web_handlers.js';
import { snapshot_classification_data } from '../lib/classification/snapshot_classification.js';
import {
  FILE_AI_REVIEW_V2,
  FILE_AI_CANDIDATES_V2,
  FILE_MANUAL_OVERRIDES,
  FILE_AI_SAMPLE,
} from '../lib/classification/paths.js';
import { REVIEW_PENDING, REVIEW_REJECTED } from '../lib/classification/ai_review_store.js';

function file_sha256(path) {
  const buf = fs.readFileSync(path);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

test('正式狀態：人工確認優先於 AI pending', function () {
  const st = resolve_formal_classification_state({
    override_row: { source: 'manual:ui', language: '中文' },
    v2_review: { status: REVIEW_PENDING },
    v2_candidate: { spotify_id: 'x' },
    in_ai_sample: true,
    index_genre_profile: null,
    index_tags: [],
  });
  assert.equal(st, FORMAL_CONFIRMED);
});

test('正式狀態：v2 rejected 為 rejected', function () {
  const st = resolve_formal_classification_state({
    v2_review: { status: REVIEW_REJECTED },
    v2_candidate: {},
    in_ai_sample: true,
  });
  assert.equal(st, FORMAL_REJECTED);
});

test('正式狀態：樣本 pending 有候選為 ai_suggested', function () {
  const st = resolve_formal_classification_state({
    v2_review: { status: REVIEW_PENDING },
    v2_candidate: { language: { value: '中文' } },
    in_ai_sample: true,
  });
  assert.equal(st, FORMAL_AI_SUGGESTED);
});

test('可信度：僅藝人定位且未錨定曲目不得 high', function () {
  const row = {
    metadata_status: 'complete',
    display: { name: '測試曲', album_name: '測試專輯' },
  };
  assert.equal(
    primary_evidence_anchors_track('某歌手 mainstream 定位為流行', row),
    false
  );
  const r = compute_confidence_tier({
    candidate: {
      language: { value: '國語', confidence: 'inferred', evidence: 'x'.repeat(12) },
      genre_profile: {
        primary_genre: {
          value: 'pop',
          confidence: 'inferred',
          evidence:
            '某歌手在華語市場定位為流行歌手，該專輯為 mainstream mandopop 發行。',
        },
      },
    },
    index_row: row,
  });
  assert.equal(r.tier, TIER_MEDIUM);
});

test('可信度：錨定歌名且 evidence 充分可為 high', function () {
  const r = compute_confidence_tier({
    candidate: {
      language: {
        value: '國語',
        confidence: 'inferred',
        evidence: '專輯《測試專輯》為華語發行。',
      },
      genre_profile: {
        primary_genre: {
          value: 'pop',
          confidence: 'inferred',
          evidence:
            '〈測試曲〉收錄於專輯《測試專輯》，為華語抒情流行單曲脈絡（公開曲目資訊）。',
        },
      },
    },
    index_row: {
      metadata_status: 'complete',
      display: { name: '測試曲', album_name: '測試專輯' },
    },
  });
  assert.equal(r.tier, TIER_HIGH);
});

test('可信度：evidence 過短不得 high', function () {
  const r = compute_confidence_tier({
    candidate: {
      language: { value: '中文', confidence: 'inferred' },
      genre_profile: {
        primary_genre: {
          value: 'pop',
          confidence: 'inferred',
          evidence: '短',
        },
      },
    },
    index_row: { metadata_status: 'complete' },
  });
  assert.equal(r.tier, TIER_LOW);
});

test('預覽模式：strict 排除 ai_suggested', function () {
  const inc = evaluate_preview_inclusion(
    { formal_state: FORMAL_AI_SUGGESTED, confidence_tier: TIER_MEDIUM },
    PREVIEW_MODE_STRICT
  );
  assert.equal(inc.included, false);
});

test('預覽模式：balanced 需 medium 以上', function () {
  const ok = evaluate_preview_inclusion(
    { formal_state: FORMAL_AI_SUGGESTED, confidence_tier: TIER_MEDIUM, v2_candidate: {} },
    PREVIEW_MODE_BALANCED
  );
  assert.equal(ok.included, true);
  const no = evaluate_preview_inclusion(
    { formal_state: FORMAL_AI_SUGGESTED, confidence_tier: TIER_LOW, v2_candidate: {} },
    PREVIEW_MODE_BALANCED
  );
  assert.equal(no.included, false);
});

test('預覽模式：relaxed 納入 low 並標風險', function () {
  const inc = evaluate_preview_inclusion(
    { formal_state: FORMAL_AI_SUGGESTED, confidence_tier: TIER_LOW, v2_candidate: {} },
    PREVIEW_MODE_RELAXED
  );
  assert.equal(inc.included, true);
  assert.ok(inc.risk_label);
});

test('智慧歌單預覽：三模式數量 strict ≤ balanced ≤ relaxed（空篩選）', function () {
  const built = build_classification_index({ write: false });
  const cmp = compare_preview_modes(built.index_doc, {});
  const s = cmp.strict.breakdown.total_unique;
  const b = cmp.balanced.breakdown.total_unique;
  const r = cmp.relaxed.breakdown.total_unique;
  assert.ok(s <= b);
  assert.ok(b <= r);
  assert.equal(cmp.strict.not_synced_spotify, true);
});

test('智慧歌單預覽：同一首歌不重複計數', function () {
  const built = build_classification_index({ write: false });
  const prev = compute_smart_playlist_preview(built.index_doc, {}, PREVIEW_MODE_RELAXED);
  assert.ok(prev.breakdown.total_unique <= built.index_doc.track_count);
});

test('批次審核：超過 30 首拒絕', function () {
  const sample = JSON.parse(fs.readFileSync(FILE_AI_SAMPLE, 'utf8'));
  const ids = sample.track_ids.slice();
  while (ids.length < 31) {
    ids.push('fake_id_' + ids.length);
  }
  const plan = plan_batch_review({
    action: 'reject',
    track_ids: ids.slice(0, 31),
    candidate_version: 2,
    settings: { batch_review_max: 30 },
  });
  assert.equal(plan.ok, false);
});

test('批次審核：dry_run 不寫 ai-review', function () {
  if (!fs.existsSync(FILE_AI_CANDIDATES_V2)) {
    return;
  }
  const before = file_sha256(FILE_AI_REVIEW_V2);
  const sample = JSON.parse(fs.readFileSync(FILE_AI_SAMPLE, 'utf8'));
  const id = sample.track_ids[0];
  execute_batch_review({
    action: 'reject',
    track_ids: [id],
    candidate_version: 2,
    dry_run: true,
  });
  const after = file_sha256(FILE_AI_REVIEW_V2);
  assert.equal(before, after);
});

test('批次審核：相同選取 fingerprint 一致', function () {
  if (!fs.existsSync(FILE_AI_CANDIDATES_V2)) {
    return;
  }
  const sample = JSON.parse(fs.readFileSync(FILE_AI_SAMPLE, 'utf8'));
  const ids = sample.track_ids.slice(0, 3);
  const a = plan_batch_review({
    action: 'reject',
    track_ids: ids,
    candidate_version: 2,
  });
  const b = plan_batch_review({
    action: 'reject',
    track_ids: ids.slice().reverse(),
    candidate_version: 2,
  });
  assert.equal(a.preview.fingerprint, b.preview.fingerprint);
});

test('API：preview/settings GET 不呼叫 Spotify', async function () {
  const res = await handle_classification_api(
    'GET',
    '/api/preview/settings',
    '',
    new URLSearchParams()
  );
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.settings.preview_mode);
});

test('API：切換 preview_mode 不寫 confirmed 到 manual-overrides', async function () {
  const before = file_sha256(FILE_MANUAL_OVERRIDES);
  await handle_classification_api(
    'POST',
    '/api/preview/settings',
    JSON.stringify({ preview_mode: 'strict' }),
    new URLSearchParams()
  );
  await handle_classification_api(
    'POST',
    '/api/preview/settings',
    JSON.stringify({ preview_mode: 'balanced' }),
    new URLSearchParams()
  );
  const after = file_sha256(FILE_MANUAL_OVERRIDES);
  assert.equal(before, after);
});

test('formal-classification-state 可離線重建', function () {
  const built = build_classification_index({ write: false });
  const doc = build_formal_classification_state(built.index_doc, { write: false });
  assert.ok(doc.states_by_track_id);
  assert.ok(doc.sample_tier_counts);
  const vals = Object.values(doc.states_by_track_id).map(function (r) {
    return r.formal_state;
  });
  for (let i = 0; i < vals.length; i += 1) {
    assert.ok(
      [
        FORMAL_CONFIRMED,
        FORMAL_AI_SUGGESTED,
        FORMAL_UNKNOWN,
        FORMAL_REJECTED,
      ].indexOf(vals[i]) >= 0
    );
  }
});

test('快照：pre-phase-d 可建立且含 v2 檔', function () {
  const snap = snapshot_classification_data('pre-phase-d-' + Date.now());
  assert.ok(snap.copied.length >= 1);
  const has_v2 = snap.copied.some(function (n) {
    return n.indexOf('ai-candidates-imported') >= 0 || n.indexOf('ai-test-v2') >= 0;
  });
  assert.ok(has_v2 || fs.existsSync(FILE_AI_CANDIDATES_V2));
});
