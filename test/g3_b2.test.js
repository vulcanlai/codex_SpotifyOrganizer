/**
 * G3-B.2 佇列、語言證據、自動複核
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  resolve_classification_queue_state,
  QUEUE_STATE,
  has_primary_genre_gap,
} from '../lib/classification/g3_b/queue_state.js';
import {
  auto_review_ai_draft_row,
  REVIEW_CONFLICT,
  REVIEW_NEEDS_EVIDENCE,
} from '../lib/classification/g3_b/auto_review.js';
import { detect_title_only_language_risk } from '../lib/classification/g3_b/language_evidence.js';
import { rule_classify_track } from '../lib/classification/g3_b/rule_classify.js';
import { run_g3_b2_offline_eval } from '../lib/classification/g3_b/run_b2_offline_eval.js';
import { import_g3_b_ai_draft } from '../lib/classification/g3_b/import_ai_draft.js';
import { G1_MUST_INCLUDE_LEMON_TREE as LEMON_ID } from '../lib/enrichment/external/g1_sample.js';

describe('G3-B.2', { concurrency: 1 }, function () {
  test('metadata 完整但主曲風 unknown 應 pending_ai', function () {
    const rule = {
      genre_profile: { primary_genre: 'unknown' },
      language: { value: '未確認' },
      classification_kind: 'unknown',
    };
    const ev = {
      track_id: 't_meta',
      human_confirmation: { locked: false },
      identity: { enrichment_cache_complete: true },
      classification_candidates: [],
      priority_resolution: { effective_for_classification: 'unknown' },
    };
    const q = resolve_classification_queue_state(ev, rule);
    assert.equal(q.queue_state, QUEUE_STATE.PENDING_AI);
    assert.equal(q.needs_ai_generation, true);
  });

  test('metadata 不完整但已有 AI 建議 → has_ai_suggestion', function () {
    const rule = {
      genre_profile: { primary_genre: 'unknown' },
      language: { value: '未確認' },
      classification_kind: 'unknown',
    };
    const ev = {
      track_id: 't_cand',
      human_confirmation: { locked: false },
      identity: { enrichment_cache_complete: false },
      classification_candidates: [{ candidate: { primary_genre: 'pop' } }],
      priority_resolution: { effective_for_classification: 'ai_suggested' },
    };
    const q = resolve_classification_queue_state(ev, rule);
    assert.equal(q.queue_state, QUEUE_STATE.HAS_AI_SUGGESTION);
    assert.equal(q.needs_ai_generation, false);
  });

  test('已有 AI 候選避免重複生成', function () {
    const draft = rule_classify_track({
      track_id: 't_dup',
      human_confirmation: { locked: false },
      priority_resolution: { effective_for_classification: 'ai_suggested' },
      identity: { enrichment_cache_complete: true },
      facts: [],
      evidence: [],
      verification_status: {},
      classification_candidates: [{ is_fact: false }],
      conflicts: [],
    });
    assert.equal(draft.queue_state, QUEUE_STATE.HAS_AI_SUGGESTION);
    assert.equal(draft.ai_pending, false);
  });

  test('Lemon Tree 語言歌名陷阱偵測', function () {
    const ev = {
      track_id: LEMON_ID,
      identity: { title: 'Lemon Tree', artists: ['蘇慧倫'] },
      facts: [{ field: 'musicbrainz_recording' }],
      human_confirmation: { locked: false },
    };
    const risk = detect_title_only_language_risk(ev, {
      value: '英文',
      evidence: '歌名 Lemon Tree 為英文，翻唱專輯脈絡',
      confidence: 'inferred',
    });
    assert.equal(risk.risky, true);
  });

  test('Lemon Tree G3-B.1 草稿自動複核 conflict', function () {
    const ev = {
      track_id: LEMON_ID,
      identity: { title: 'Lemon Tree' },
      human_confirmation: { locked: false },
      priority_resolution: { effective_for_classification: 'ai_suggested' },
      facts: [],
    };
    const rule = rule_classify_track({
      track_id: LEMON_ID,
      human_confirmation: { locked: false },
      priority_resolution: { effective_for_classification: 'ai_suggested' },
      identity: { enrichment_cache_complete: true, title: 'Lemon Tree' },
      facts: [{ field: 'musicbrainz_recording' }],
      evidence: [],
      verification_status: {
        g2: { verify_status: 'matched', pending_verification: false },
      },
      classification_candidates: [{}],
      conflicts: [],
    });
    const review = auto_review_ai_draft_row(ev, rule, {
      track_id: LEMON_ID,
      language: {
        value: '英文',
        confidence: 'inferred',
        evidence: '歌名 Lemon Tree 為英文',
        vocal_verification_status: 'unverified',
      },
      genre_profile: { primary_genre: 'pop', subgenres: ['synth_pop'], confidence: 'inferred' },
    });
    assert.equal(review.status, REVIEW_CONFLICT);
    assert.ok(review.issues.some(function (x) {
      return x.indexOf('fixture') >= 0;
    }));
  });

  test('AI 推測不得宣稱 MB 語言查證', function () {
    assert.throws(function () {
      import_g3_b_ai_draft(
        {
          tracks: [
            {
              track_id: 'x1',
              confidence: 'inferred',
              genre_profile: { primary_genre: 'pop', confidence: 'inferred' },
              language: {
                value: '英文',
                confidence: 'inferred',
                evidence: 'MusicBrainz 查證演唱語言為英文',
                vocal_verification_status: 'unverified',
              },
            },
          ],
        },
        { write: false, skip_pending_gate: true }
      );
    });
  });

  test('人工確認優先不進 pending', function () {
    const q = resolve_classification_queue_state(
      {
        track_id: 'h1',
        human_confirmation: { locked: true },
        identity: { enrichment_cache_complete: true },
        classification_candidates: [{}],
      },
      {
        genre_profile: { primary_genre: 'unknown' },
        language: { value: '未確認' },
      }
    );
    assert.equal(q.queue_state, QUEUE_STATE.HUMAN_CONFIRMED);
  });

  test('離線評估可執行且不寫 G3-B.1 草稿', function () {
    if (!fs.existsSync('backup/classification/g3-evidence/evidence-index.json')) {
      return;
    }
    const before = fs.statSync(
      'backup/classification/g3-b-trial-30/ai-classification-draft.json'
    ).mtimeMs;
    run_g3_b2_offline_eval({ write: true });
    const after = fs.statSync(
      'backup/classification/g3-b-trial-30/ai-classification-draft.json'
    ).mtimeMs;
    assert.equal(before, after);
    assert.ok(fs.existsSync('backup/classification/g3-b2-trial-30/re-evaluation-summary.json'));
  });

  test('主曲風缺口判定', function () {
    assert.equal(has_primary_genre_gap({ genre_profile: { primary_genre: 'unknown' } }), true);
    assert.equal(has_primary_genre_gap({ genre_profile: { primary_genre: 'pop' } }), false);
  });
});
