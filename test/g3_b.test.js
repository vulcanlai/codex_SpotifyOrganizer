/**
 * G3-B 自動分類試驗
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rule_classify_track, validate_genre_profile_draft } from '../lib/classification/g3_b/rule_classify.js';
import { QUEUE_STATE } from '../lib/classification/g3_b/queue_state.js';
import { run_g3_b_trial_pipeline } from '../lib/classification/g3_b/pipeline.js';
import { import_g3_b_ai_draft } from '../lib/classification/g3_b/import_ai_draft.js';
import { ensure_g3_b_sample } from '../lib/classification/g3_b/sample.js';
import { resolve_human_confirmation } from '../lib/classification/g3_evidence/human_confirmation.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../lib/enrichment/external/g1_sample.js';

describe('G3-B 自動分類', { concurrency: 1 }, function () {
  test('30 首樣本沿用 G1', function () {
    const s = ensure_g3_b_sample({ write: false });
    assert.equal(s.track_count, 30);
    assert.ok(s.track_ids.indexOf(G1_MUST_INCLUDE_LEMON_TREE) >= 0);
  });

  test('人工確認：ai-review accepted 視為 locked', function () {
    const h = resolve_human_confirmation('0WeN17PUto5ZdSqkUBDOsX', {
      index_row: {
        tags: [{ is_manual_override: true, dimension: 'language' }],
        genre_profile: { source: 'manual-overrides.json', primary_genre: 'pop' },
      },
      overrides_doc: { overrides_by_track_id: {} },
      v2_review: { status: 'accepted', source: 'classify:ui' },
    });
    assert.equal(h.locked, true);
    assert.ok(h.sources.indexOf('ai-review:v2-30:accepted') >= 0);
  });

  test('unverified_cross_script 降低為 inference 且 tier 低', function () {
    const draft = rule_classify_track({
      track_id: 't1',
      human_confirmation: { locked: false },
      priority_resolution: {},
      identity: { enrichment_cache_complete: true },
      facts: [],
      evidence: [
        {
          field: 'musicbrainz_genre_tags',
          value: ['pop'],
          note: 'weak',
        },
      ],
      verification_status: {
        g2_1_offline: {
          verify_status: 'matched',
          artist_match_status: 'unverified_cross_script',
          pending_verification: true,
          artist_verified: false,
        },
      },
      classification_candidates: [],
      conflicts: [],
    });
    assert.equal(draft.classification_kind, 'inference');
    assert.equal(draft.confidence_tier, 'low');
    assert.ok(draft.uncertainty.length >= 1);
  });

  test('AI 候選 → has_ai_suggestion 不重複排隊', function () {
    const draft = rule_classify_track({
      track_id: 't2',
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
    assert.equal(draft.needs_ai_generation, false);
  });

  test('人工鎖定不得被規則改寫', function () {
    const draft = rule_classify_track({
      track_id: 't3',
      human_confirmation: { locked: true, sources: ['ai-review'] },
      priority_resolution: { effective_for_classification: 'human_confirmed' },
      identity: {},
      facts: [],
      evidence: [
        {
          field: 'human_confirmation',
          value: {
            genre_profile: {
              primary_genre: 'pop',
              subgenres: [],
              source: 'manual-overrides.json',
            },
          },
        },
      ],
      verification_status: {},
      classification_candidates: [],
      conflicts: [],
    });
    assert.equal(draft.classification_kind, 'human_locked');
    assert.equal(draft.human_locked, true);
    assert.equal(draft.genre_profile.primary_genre, 'pop');
  });

  test('主曲風字典驗證', function () {
    assert.equal(validate_genre_profile_draft({ primary_genre: 'pop' }), true);
    assert.equal(validate_genre_profile_draft({ primary_genre: 'invalid_x' }), false);
  });

  test('AI 匯入拒絕 confirmed', function () {
    assert.throws(function () {
      import_g3_b_ai_draft(
        {
          tracks: [{ track_id: 'x', confidence: 'confirmed', genre_profile: { primary_genre: 'pop' } }],
        },
        { write: false, skip_pending_gate: true }
      );
    });
  });

  test('AI 匯入拒絕非待處理清單曲目', function () {
    assert.throws(function () {
      import_g3_b_ai_draft(
        {
          tracks: [
            {
              track_id: 'not-in-pending-list-xxx',
              confidence: 'inferred',
              genre_profile: { primary_genre: 'pop', confidence: 'inferred' },
            },
          ],
        },
        { write: false }
      );
    });
  });

  test('管線可重複執行', function (t) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g3b-'));
    const prev = process.env.SPOTIFYORG_G3_EVIDENCE_DIR;
    process.env.SPOTIFYORG_G3_EVIDENCE_DIR = tmp;
    t.after(function () {
      if (prev === undefined) {
        delete process.env.SPOTIFYORG_G3_EVIDENCE_DIR;
      } else {
        process.env.SPOTIFYORG_G3_EVIDENCE_DIR = prev;
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    });
    const a = run_g3_b_trial_pipeline({ write: false });
    const b = run_g3_b_trial_pipeline({ write: false });
    assert.equal(a.rule_doc.tracks.length, 30);
    assert.equal(a.rule_doc.tracks.length, b.rule_doc.tracks.length);
  });
});
