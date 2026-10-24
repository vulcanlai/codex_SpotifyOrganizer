/**
 * G3 情緒 Phase 0 規格（taxonomy／validate／tier／試驗指標）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMOTION_CODES, is_emotion_code } from '../lib/classification/g3_emotion/emotion_taxonomy.js';
import { validate_emotion_inference } from '../lib/classification/g3_emotion/validate_emotion_inference.js';
import {
  compute_emotion_label_tier,
  compute_emotion_track_tier,
  EMOTION_TIER_HIGH,
  EMOTION_TIER_LOW,
  EMOTION_TIER_NONE,
} from '../lib/classification/g3_emotion/emotion_confidence_tier.js';
import { compute_emotion_trial_batch_metrics } from '../lib/classification/g3_emotion/emotion_trial_metrics.js';

test('六大情緒 code', function () {
  assert.equal(EMOTION_CODES.length, 6);
  assert.equal(is_emotion_code('melancholy_sad'), true);
  assert.equal(is_emotion_code('pop'), false);
});

test('允許空 emotion_labels', function () {
  const r = validate_emotion_inference({
    track_id: 'abc',
    emotion_labels: [],
  });
  assert.equal(r.ok, true);
  assert.equal(r.derived.emotion_track_tier, EMOTION_TIER_NONE);
});

test('拒絕無音訊卻描述編曲聽感', function () {
  const r = validate_emotion_inference({
    track_id: 't1',
    emotion_labels: [
      {
        code: 'relaxed_comfort',
        confidence: 'inferred',
        review_status: 'pending',
        evidence_axes: {
          sonic: {
            summary_zh: '編曲偏柔和鋼琴',
            confidence: 'inferred',
            basis: ['agent_inference_declared'],
            direct_audio_verified: false,
          },
        },
        evidence_used: ['identity.title'],
      },
    ],
  });
  assert.equal(r.ok, false);
});

test('拒絕由曲長推斷快板', function () {
  const r = validate_emotion_inference({
    track_id: 't2',
    emotion_labels: [
      {
        code: 'energetic_passion',
        confidence: 'inferred',
        review_status: 'pending',
        evidence_axes: {
          rhythmic: {
            summary_zh: '曲長推估偏快的中板',
            confidence: 'inferred',
            basis: ['identity.duration_ms_fact_only'],
            tempo_bpm_known: false,
          },
        },
        evidence_used: ['identity.duration_ms'],
      },
    ],
  });
  assert.equal(r.ok, false);
});

test('拒絕 explicit basis', function () {
  const r = validate_emotion_inference({
    track_id: 't3',
    emotion_labels: [
      {
        code: 'upbeat_joy',
        confidence: 'unknown',
        review_status: 'pending',
        evidence_axes: {
          lyrical: {
            summary_zh: '',
            confidence: 'unknown',
            basis: ['explicit'],
          },
        },
        evidence_used: [],
      },
    ],
  });
  assert.equal(r.ok, false);
});

test('僅歌名弱線索不得 inferred 情緒', function () {
  const r = validate_emotion_inference({
    track_id: 't4',
    emotion_labels: [
      {
        code: 'romantic_tender',
        confidence: 'inferred',
        review_status: 'pending',
        evidence_axes: {
          lyrical: {
            summary_zh: '歌名含愛',
            confidence: 'inferred',
            basis: ['weak_metadata_title'],
            lyric_text_available: false,
          },
        },
        evidence_used: ['identity.title'],
      },
    ],
  });
  assert.equal(r.ok, false);
});

test('human_listen_review 可達 high tier', function () {
  const label = {
    code: 'melancholy_sad',
    confidence: 'inferred',
    review_status: 'pending',
    evidence_axes: {
      sonic: {
        summary_zh: '試聽感受偏哀傷（人工紀錄）',
        confidence: 'inferred',
        basis: ['human_listen_review'],
        direct_audio_verified: true,
      },
    },
    evidence_used: ['human_listen_review'],
  };
  assert.equal(compute_emotion_label_tier(label), EMOTION_TIER_HIGH);
  const v = validate_emotion_inference({
    track_id: 't5',
    emotion_labels: [label],
  });
  assert.equal(v.ok, true);
});

test('unknown 標籤 tier 為 none', function () {
  const label = {
    code: 'late_night_calm',
    confidence: 'unknown',
    review_status: 'pending',
    evidence_axes: {
      sonic: {
        summary_zh: '無音訊證據',
        confidence: 'unknown',
        basis: ['weak_metadata_album'],
        direct_audio_verified: false,
      },
    },
    evidence_used: ['identity.album_name'],
  };
  assert.equal(compute_emotion_label_tier(label), EMOTION_TIER_NONE);
});

test('80 首試驗指標 gates', function () {
  const good = {
    track_id: 'g1',
    emotion_labels: [],
  };
  const bad = {
    track_id: 'b1',
    emotion_labels: [
      {
        code: 'upbeat_joy',
        confidence: 'inferred',
        review_status: 'pending',
        evidence_axes: {
          sonic: {
            summary_zh: '編曲明亮',
            confidence: 'inferred',
            basis: ['weak_metadata_title'],
            direct_audio_verified: false,
          },
        },
        evidence_used: ['identity.title'],
      },
    ],
  };
  const batch_ok = [];
  for (let i = 0; i < 80; i += 1) {
    batch_ok.push({ ...good, track_id: 'g' + i });
  }
  const m_ok = compute_emotion_trial_batch_metrics(batch_ok);
  assert.equal(m_ok.schema_pass_rate, 1);
  assert.equal(m_ok.trial_pass, true);

  const batch_mix = batch_ok.slice(0, 79).concat([bad]);
  const m_mix = compute_emotion_trial_batch_metrics(batch_mix);
  assert.equal(m_mix.schema_fail, 1);
  assert.equal(m_mix.title_only_inferred_label_rate, 1);
  assert.equal(m_mix.gates.title_only_inferred_rate_ok, false);
  assert.equal(m_mix.trial_pass, false);
});

test('track tier 取標籤最高', function () {
  const tier = compute_emotion_track_tier({
    emotion_labels: [
      {
        code: 'relaxed_comfort',
        confidence: 'unknown',
        evidence_axes: {},
      },
      {
        code: 'melancholy_sad',
        confidence: 'inferred',
        evidence_axes: {
          sonic: {
            summary_zh: '試聽',
            basis: ['human_listen_review'],
            direct_audio_verified: true,
          },
        },
      },
    ],
  });
  assert.equal(tier, EMOTION_TIER_HIGH);
});
