/**
 * G2.1 跨語系藝人與 fallback 查詢
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reset_rate_limit_clock_for_tests } from '../lib/enrichment/external/mb_http.js';
import { musicbrainz_provider, build_recording_search_query } from '../lib/enrichment/external/musicbrainz_provider.js';
import {
  evaluate_isrc_artist_evidence,
} from '../lib/enrichment/external/verify_match_tier.js';
import { ARTIST_MATCH_STATUS, artist_overlap_metrics } from '../lib/enrichment/external/artist_evidence.js';
import { verify_track_online_v2, recompute_verification_from_candidates } from '../lib/enrichment/external/verify_engine.js';
import { build_g2_1_offline_replay_report } from '../lib/enrichment/external/g2_1_offline_replay.js';
import { set_verify_engine } from '../lib/enrichment/external/verify_data_dir.js';
import { load_progress, load_query_cache } from '../lib/enrichment/external/verification_store.js';
import { G1_TRIAL_DIR } from '../lib/enrichment/external/g1_path_resolve.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../lib/enrichment/external/g1_sample.js';

describe('G2.1 查證', { concurrency: 1 }, function () {
  test('跨語系 ISRC 直配：不判衝突、藝人尚未核實', function () {
    const input = {
      spotify_id: 'x1',
      title: '心愛的再會啦',
      artists: ['Wu Bai'],
      duration_ms: 335000,
    };
    const best = {
      title: '心愛的再會啦',
      artist_names: ['伍佰 & China Blue'],
      match_score: 60,
      artist_best_ratio: 0,
    };
    const ev = evaluate_isrc_artist_evidence({
      input: input,
      best: best,
      extra_artist_names: ['Wu Bai'],
      isrc_candidate_count: 1,
    });
    assert.equal(ev.isrc_conflict, false);
    assert.equal(ev.artist_match_status, ARTIST_MATCH_STATUS.unverified_cross_script);
  });

  test('同書寫系統、不同藝人：仍判衝突', function () {
    const ev = evaluate_isrc_artist_evidence({
      input: { title: 'Hello', artists: ['Alice Alpha'] },
      best: { title: 'Hello', artist_names: ['Bob Beta'] },
      extra_artist_names: [],
      isrc_candidate_count: 1,
    });
    assert.equal(ev.isrc_conflict, true);
  });

  test('韓文／英文：cross_script 不單獨構成衝突', function () {
    const ev = evaluate_isrc_artist_evidence({
      input: { title: '구르미 그린 달빛', artists: ['GUMMY'] },
      best: { title: '구르미 그린 달빛', artist_names: ['거미'] },
      extra_artist_names: ['GUMMY'],
      isrc_candidate_count: 1,
    });
    assert.equal(ev.isrc_conflict, false);
    assert.equal(ev.artist_match_status, ARTIST_MATCH_STATUS.unverified_cross_script);
  });

  test('多位合作藝人：比對集合非只看第一位', function () {
    const m = artist_overlap_metrics(
      ['Wakin Chau', 'Jonathan Lee', 'Victor Wong'],
      ['品冠', '周華健', '李宗盛']
    );
    assert.equal(m.artist_best_ratio, 0);
    assert.equal(m.cross_script_only, true);
    assert.equal(m.local_count, 3);
    assert.equal(m.ext_count, 3);
  });

  test('無可靠別名且同系統不同名：衝突', function () {
    const ev = evaluate_isrc_artist_evidence({
      input: { title: 'Same Song', artists: ['Artist One'] },
      best: { title: 'Same Song', artist_names: ['Completely Different'] },
      extra_artist_names: [],
      isrc_candidate_count: 1,
    });
    assert.equal(ev.isrc_conflict, true);
  });

  test('fallback Lucene：拉丁藝人時僅歌名', function () {
    const q = build_recording_search_query(
      { title: '舞月光', artists: ['SKY WU'] },
      { search_artist: 'SKY WU' }
    );
    assert.ok(q.indexOf('AND artist:') < 0);
    assert.ok(q.indexOf('舞月光') >= 0);
  });

  test('fallback Lucene：CJK 藝人仍 AND artist', function () {
    const q = build_recording_search_query(
      { title: '舞月光', artists: ['Wu Bai'] },
      { search_artist: '伍佰' }
    );
    assert.ok(q.indexOf('AND artist:') >= 0);
  });

  test('fallback 僅一次搜尋', async function () {
    reset_rate_limit_clock_for_tests();
    let search_n = 0;
    const fetch_fn = async function (url) {
      if (url.indexOf('/isrc/') >= 0) {
        return {
          ok: false,
          status: 404,
          headers: { get: function () { return null; } },
          json: async function () { return {}; },
        };
      }
      search_n += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: function () { return null; } },
        json: async function () {
          return { recordings: [] };
        },
      };
    };
    await verify_track_online_v2(
      {
        spotify_id: 'fb-once',
        title: 'T',
        artists: ['A'],
        isrc: 'XX0000000099',
        duration_ms: 100000,
      },
      { fetch_fn: fetch_fn, cache: load_query_cache(), progress: load_progress() }
    );
    assert.equal(search_n, 1);
  });

  test('429 不當 not_found', async function () {
    reset_rate_limit_clock_for_tests();
    await assert.rejects(function () {
      return musicbrainz_provider.lookup_by_isrc_safe(fetch_stub_429, 'USXXX1234567');
    });
  });

  test('離線重播：不覆寫 g2 verification-results', function () {
    const g2_ver = path.join(G1_TRIAL_DIR, '..', 'g2-30', 'verification-results.json');
    if (!fs.existsSync(g2_ver)) {
      return;
    }
    const before = fs.readFileSync(g2_ver, 'utf8');
    build_g2_1_offline_replay_report({ write: true });
    assert.equal(fs.readFileSync(g2_ver, 'utf8'), before);
  });

  test('四首降級曲離線重算應回 matched', function () {
    const g2_ver_path = path.join(G1_TRIAL_DIR, '..', 'g2-30', 'verification-results.json');
    if (!fs.existsSync(g2_ver_path)) {
      return;
    }
    const report = build_g2_1_offline_replay_report({ write: false });
    const ids = [
      '07BLMnpZYg6RT0H1elobry',
      '0OsnKPaV2R8FmE2HRw1WTS',
      '0cdD41ei03AR3cAynWDIoV',
      '0kowEmoCAdTMJj5dm44eGK',
    ];
    for (let i = 0; i < ids.length; i += 1) {
      const row = report.per_track.find(function (r) {
        return r.spotify_id === ids[i];
      });
      assert.ok(row, ids[i]);
      assert.equal(
        row.g2_1_offline_status,
        'matched',
        row.title + ' got ' + row.g2_1_offline_status
      );
      assert.equal(row.isrc_conflict, false);
    }
  });

  test('Lemon Tree 離線重算仍 matched', function () {
    const g2_ver_path = path.join(G1_TRIAL_DIR, '..', 'g2-30', 'verification-results.json');
    if (!fs.existsSync(g2_ver_path)) {
      return;
    }
    const report = build_g2_1_offline_replay_report({ write: false });
    const row = report.per_track.find(function (r) {
      return r.spotify_id === G1_MUST_INCLUDE_LEMON_TREE;
    });
    assert.ok(row);
    assert.equal(row.g2_1_offline_status, 'matched');
  });

  test('G1/G2 目錄隔離', function (t) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g21-iso-'));
    t.after(function () {
      fs.rmSync(tmp, { recursive: true, force: true });
      set_verify_engine('g1');
    });
    process.env.SPOTIFYORG_G2_DATA_DIR = tmp;
    set_verify_engine('g2');
    const row = recompute_verification_from_candidates(
      { spotify_id: 'z', title: 'A', artists: ['B'], duration_ms: 1000 },
      [],
      { isrc_used: false }
    );
    assert.equal(row.verify_engine, 'g2.1');
    assert.ok(!fs.existsSync(path.join(G1_TRIAL_DIR, 'verification-results.json.bak')));
  });
});

async function fetch_stub_429() {
  return {
    ok: false,
    status: 429,
    headers: { get: function () { return '0'; } },
  };
}
