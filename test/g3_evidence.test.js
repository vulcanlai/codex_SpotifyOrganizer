/**
 * G3-A 統一證據層
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { build_track_evidence_doc } from '../lib/classification/g3_evidence/build_track_evidence.js';
import { build_g3_evidence_index } from '../lib/classification/g3_evidence/build_evidence_index.js';
import { FILE_CLASSIFICATION_INDEX, FILE_MANUAL_OVERRIDES } from '../lib/classification/paths.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../lib/enrichment/external/g1_sample.js';

function mock_bundle(overrides) {
  const base = {
    index: {
      tracks_by_id: {
        tid1: {
          spotify_id: 'tid1',
          metadata_status: 'complete',
          enrichment_cache_complete: true,
          display: {
            name: 'Test Song',
            artists: ['Wu Bai'],
            album_name: 'Al',
            release_date: '2000-01-01',
          },
          merged_metadata: { artists: ['Wu Bai'], duration_ms: 200000 },
          tags: [
            {
              dimension: 'language',
              value: '未確認',
              source: 'classification_rules_v1',
              method: 'default_unknown',
              confidence: 'unknown',
            },
          ],
        },
      },
    },
    formal_state: { states_by_track_id: {} },
    metadata_cache: {
      tracks_by_id: {
        tid1: {
          isrc: 'TWTEST000001',
          duration_ms: 200000,
          fetched_at: '2026-01-01T00:00:00.000Z',
        },
      },
    },
    manual_overrides: { overrides_by_track_id: {} },
    g1_verification: { tracks: {} },
    g2_verification: { tracks: {} },
    g2_1_by_id: {},
    sample_sets: { g1_g2: {}, v2: {}, phase_e: {} },
    ai_candidate_by_id: {},
    ai_review_by_id: {},
    source_refs: {
      classification_index: 'mock/index.json',
      track_metadata_cache: 'mock/cache.json',
      g1_verification: 'mock/g1.json',
      g2_verification: 'mock/g2.json',
      g2_1_offline_replay: 'mock/g2_1.json',
      formal_classification_state: 'mock/formal.json',
    },
  };
  return Object.assign(base, overrides || {});
}

describe('G3-A 證據', { concurrency: 1 }, function () {
  test('Spotify ID 對應 identity 與 ISRC', function () {
    const doc = build_track_evidence_doc('tid1', mock_bundle());
    assert.ok(doc);
    assert.equal(doc.track_id, 'tid1');
    assert.equal(doc.identity.isrc, 'TWTEST000001');
  });

  test('G2.1 unverified_cross_script 不得 artist_verified', function () {
    const id = 'tid_mb';
    const bundle = mock_bundle({
      sample_sets: { g1_g2: { tid_mb: true }, v2: {}, phase_e: {} },
      g2_verification: {
        tracks: {
          tid_mb: {
            verify_status: 'matched',
            match_tier: 'isrc_direct',
            artist_match_status: 'unverified_cross_script',
            isrc_conflict: false,
            verified_at: '2026-01-01T00:00:00.000Z',
            best_match: {
              external_id: 'mb-1',
              title: 'Test Song',
              artist_names: ['伍佰'],
              tags: ['rock'],
              source_url: 'https://musicbrainz.org/recording/mb-1',
            },
            candidates: [],
          },
        },
      },
      g2_1_by_id: {
        tid_mb: {
          g2_1_offline_status: 'matched',
          g2_1_match_tier: 'isrc_direct',
          artist_match_status: 'unverified_cross_script',
          isrc_conflict: false,
          mb_recording_id: 'mb-1',
        },
      },
      index: {
        tracks_by_id: {
          tid_mb: {
            display: { name: 'Test Song', artists: ['Wu Bai'], album_name: 'Al' },
            tags: [],
          },
        },
      },
      metadata_cache: { tracks_by_id: {} },
    });
    const doc = build_track_evidence_doc('tid_mb', bundle);
    assert.equal(doc.verification_status.g2_1_offline.artist_verified, false);
    assert.equal(doc.verification_status.g2_1_offline.pending_verification, true);
    const rec_fact = doc.facts.some(function (f) {
      return f.field === 'musicbrainz_recording';
    });
    assert.equal(rec_fact, false);
    const cand = doc.evidence.some(function (e) {
      return e.field === 'musicbrainz_recording_candidate';
    });
    assert.ok(cand);
  });

  test('AI 候選標為 is_ai_candidate 非 direct fact', function () {
    const bundle = mock_bundle({
      ai_candidate_by_id: {
        tid1: {
          batch_id: 'v2-30',
          candidate: {
            spotify_id: 'tid1',
            primary_genre: 'pop',
            language: 'mandarin',
          },
        },
      },
    });
    const doc = build_track_evidence_doc('tid1', bundle);
    assert.equal(doc.classification_candidates.length, 1);
    assert.equal(doc.classification_candidates[0].is_fact, false);
    const ai_ev = doc.evidence.find(function (e) {
      return e.is_ai_candidate;
    });
    assert.ok(ai_ev);
    assert.equal(ai_ev.is_direct_fact, false);
  });

  test('人工覆寫優先權', function () {
    const bundle = mock_bundle({
      manual_overrides: {
        overrides_by_track_id: {
          tid1: { language: 'mandarin', source: 'manual_ui' },
        },
      },
      formal_state: {
        states_by_track_id: {
          tid1: { formal_state: 'confirmed' },
        },
      },
    });
    const doc = build_track_evidence_doc('tid1', bundle);
    assert.equal(doc.priority_resolution.effective_for_classification, 'manual_override');
  });

  test('缺少 metadata 列入 missing_fields', function () {
    const bundle = mock_bundle({ metadata_cache: { tracks_by_id: {} } });
    const doc = build_track_evidence_doc('tid1', bundle);
    assert.ok(doc.missing_fields.indexOf('spotify_metadata_cache') >= 0);
  });

  test('全庫索引重建：重複建置結果一致', function () {
    if (!fs.existsSync(FILE_CLASSIFICATION_INDEX)) {
      return;
    }
    const idx_before = fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8');
    const expected_count = Object.keys(JSON.parse(idx_before).tracks_by_id || {}).length;
    const a = build_g3_evidence_index({ write: false });
    const b = build_g3_evidence_index({ write: false });
    assert.equal(a.index_doc.track_count, expected_count);
    assert.equal(a.index_doc.track_count, b.index_doc.track_count);
    assert.equal(
      a.index_doc.source_fingerprints.classification_index,
      b.index_doc.source_fingerprints.classification_index
    );
  });

  test('寫入隔離目錄不動正式備份', function (t) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-ev-'));
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
    build_g3_evidence_index({
      write: true,
      bundle: mock_bundle(),
      limit_tracks: 1,
    });
    assert.ok(fs.existsSync(path.join(tmp, 'evidence-index.json')));
  });

  test('Lemon Tree 含 g1/g2/g2_1 三層', function () {
    if (!fs.existsSync(FILE_CLASSIFICATION_INDEX)) {
      return;
    }
    const result = build_g3_evidence_index({ write: false });
    const doc = result.index_doc;
    const row = doc.tracks[G1_MUST_INCLUDE_LEMON_TREE];
    assert.ok(row);
    assert.ok(row.verification_status.g1);
    assert.ok(row.verification_status.g2);
    assert.ok(row.verification_status.g2_1_offline);
  });
});
