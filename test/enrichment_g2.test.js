/**
 * 階段 G2：ISRC fallback 與查證引擎
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { reset_rate_limit_clock_for_tests } from '../lib/enrichment/external/mb_http.js';
import { musicbrainz_provider } from '../lib/enrichment/external/musicbrainz_provider.js';
import { verify_track_online_v2 } from '../lib/enrichment/external/verify_engine.js';
import { run_g2_verification } from '../lib/enrichment/external/run_g2_verification.js';
import { set_verify_engine } from '../lib/enrichment/external/verify_data_dir.js';
import { G1_TRIAL_DIR } from '../lib/enrichment/external/g1_path_resolve.js';
import {
  load_verification_results,
  load_query_cache,
  load_progress,
} from '../lib/enrichment/external/verification_store.js';
import { G1_MUST_INCLUDE_LEMON_TREE } from '../lib/enrichment/external/g1_sample.js';
import { evaluate_isrc_artist_evidence } from '../lib/enrichment/external/verify_match_tier.js';
import { artist_name_variants_for_track } from '../lib/enrichment/external/artist_name_variants.js';
import { build_g1_g2_compare_report } from '../lib/enrichment/external/g2_compare.js';
import { detect_ambiguity } from '../lib/enrichment/external/match_scoring.js';
import { is_verification_final } from '../lib/enrichment/external/verification_store.js';

const ENV_G2 = 'SPOTIFYORG_G2_DATA_DIR';

function with_g2_tmp(t, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spotifyorg-g2-'));
  const prev = process.env[ENV_G2];
  process.env[ENV_G2] = tmp;
  set_verify_engine('g2');
  t.after(function () {
    if (prev === undefined) {
      delete process.env[ENV_G2];
    } else {
      process.env[ENV_G2] = prev;
    }
    set_verify_engine('g1');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  return fn(tmp);
}

describe('G2 查證', { concurrency: 1 }, function () {
  test('ISRC 404 後執行備援搜尋', async function (t) {
    await with_g2_tmp(t, async function () {
      let calls = 0;
      const fetch_fn = async function (url) {
        calls += 1;
        if (url.indexOf('/isrc/') >= 0) {
          return {
            ok: false,
            status: 404,
            headers: { get: function () { return null; } },
            json: async function () {
              return {};
            },
          };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: function () { return null; } },
          json: async function () {
            return {
              recordings: [
                {
                  id: 'rec-fallback-1',
                  title: 'Dance Moon',
                  length: 200000,
                  'artist-credit': [{ name: 'SKY WU' }],
                },
              ],
            };
          },
        };
      };
      reset_rate_limit_clock_for_tests();
      const input = {
        spotify_id: 'test-isrc-404',
        title: 'Dance Moon',
        artists: ['SKY WU'],
        isrc: 'TWA239700072',
        duration_ms: 200000,
      };
      const ctx = {
        fetch_fn: fetch_fn,
        cache: load_query_cache(),
        progress: load_progress(),
      };
      const row = await verify_track_online_v2(input, ctx);
      assert.ok(calls >= 2);
      assert.equal(row.fallback_search_used, true);
      assert.ok(row.candidates.length >= 1);
    });
  });

  test('ISRC 成功時不重複搜尋', async function (t) {
    await with_g2_tmp(t, async function () {
      let search_called = false;
      const fetch_fn = async function (url) {
        if (url.indexOf('/isrc/') >= 0) {
          return {
            ok: true,
            status: 200,
            headers: { get: function () { return null; } },
            json: async function () {
              return {
                recordings: [
                  {
                    id: 'rec-isrc-ok',
                    title: 'Lemon Tree',
                    length: 193000,
                    'artist-credit': [{ name: '蘇慧倫' }],
                  },
                ],
              };
            },
          };
        }
        search_called = true;
        return { ok: true, status: 200, headers: { get: function () { return null; } }, json: async function () { return { recordings: [] }; } };
      };
      reset_rate_limit_clock_for_tests();
      const row = await verify_track_online_v2(
        {
          spotify_id: G1_MUST_INCLUDE_LEMON_TREE,
          title: 'Lemon Tree',
          artists: ['蘇慧倫'],
          isrc: 'TWA459650601',
          duration_ms: 194066,
        },
        { fetch_fn: fetch_fn, cache: load_query_cache(), progress: load_progress() }
      );
      assert.equal(search_called, false);
      assert.equal(row.verify_status, 'matched');
      const artists_joined = row.best_match.artist_names.join(' ');
      assert.ok(artists_joined.indexOf('Fool') < 0);
      assert.ok(artists_joined.indexOf('蘇慧倫') >= 0);
    });
  });

  test('備援搜尋找不到 → not_found', async function (t) {
    await with_g2_tmp(t, async function () {
      const fetch_fn = async function (url) {
        return {
          ok: url.indexOf('/isrc/') >= 0 ? false : true,
          status: url.indexOf('/isrc/') >= 0 ? 404 : 200,
          headers: { get: function () { return null; } },
          json: async function () {
            return { recordings: [] };
          },
        };
      };
      reset_rate_limit_clock_for_tests();
      const row = await verify_track_online_v2(
        {
          spotify_id: 'nf1',
          title: 'No Such Song XYZ',
          artists: ['Nobody'],
          isrc: 'XX0000000000',
          duration_ms: 100000,
        },
        { fetch_fn: fetch_fn, cache: load_query_cache(), progress: load_progress() }
      );
      assert.equal(row.verify_status, 'not_found');
    });
  });

  test('429 不當成 404', async function () {
    reset_rate_limit_clock_for_tests();
    const fetch_fn = async function () {
      return {
        ok: false,
        status: 429,
        headers: { get: function () { return '0'; } },
      };
    };
    await assert.rejects(function () {
      return musicbrainz_provider.lookup_by_isrc_safe(fetch_fn, 'USXXX1234567');
    });
  });

  test('ISRC 命中但歌名明顯不符 → conflict', function () {
    const ev = evaluate_isrc_artist_evidence({
      input: { title: '完全不同', artists: ['A'] },
      best: { title: 'Other Song', artist_names: ['B'] },
      extra_artist_names: [],
      isrc_candidate_count: 1,
    });
    assert.equal(ev.isrc_conflict, true);
  });

  test('Lemon Tree 本機藝人變體含中文', function () {
    const v = artist_name_variants_for_track(G1_MUST_INCLUDE_LEMON_TREE);
    assert.ok(v.names.indexOf('蘇慧倫') >= 0);
    assert.equal(v.search_artist, '蘇慧倫');
  });

  test('G2 快取不寫入 G1 目錄', async function (t) {
    await with_g2_tmp(t, async function (tmp) {
      const g1_ver_before = fs.existsSync(path.join(G1_TRIAL_DIR, 'verification-results.json'))
        ? fs.readFileSync(path.join(G1_TRIAL_DIR, 'verification-results.json'), 'utf8')
        : null;
      let n = 0;
      const fetch_fn = async function (url) {
        n += 1;
        if (url.indexOf('/isrc/') >= 0) {
          return {
            ok: false,
            status: 404,
            headers: { get: function () { return null; } },
            json: async function () { return {}; },
          };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: function () { return null; } },
          json: async function () {
            return { recordings: [] };
          },
        };
      };
      reset_rate_limit_clock_for_tests();
      await run_g2_verification({
        online: true,
        fetch_fn: fetch_fn,
        force: true,
        max_tracks: 1,
      });
      assert.ok(fs.existsSync(path.join(tmp, 'verification-results.json')));
      if (g1_ver_before !== null) {
        assert.equal(
          fs.readFileSync(path.join(G1_TRIAL_DIR, 'verification-results.json'), 'utf8'),
          g1_ver_before
        );
      }
    });
  });

  test('G1 vs G2 比較報告可離線產生', function () {
    const report = build_g1_g2_compare_report({ write: false });
    assert.ok(report.g1);
    assert.ok(report.g2);
    assert.ok(Array.isArray(report.per_track));
  });

  test('備援搜尋多候選 → ambiguous', async function (t) {
    await with_g2_tmp(t, async function () {
      const fetch_fn = async function (url) {
        if (url.indexOf('/isrc/') >= 0) {
          return {
            ok: false,
            status: 404,
            headers: { get: function () { return null; } },
            json: async function () { return {}; },
          };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: function () { return null; } },
          json: async function () {
            return {
              recordings: [
                {
                  id: 'rec-a',
                  title: 'Same Title',
                  length: 200000,
                  'artist-credit': [{ name: 'Artist A' }],
                },
                {
                  id: 'rec-b',
                  title: 'Same Title',
                  length: 201000,
                  'artist-credit': [{ name: 'Artist A' }],
                },
              ],
            };
          },
        };
      };
      reset_rate_limit_clock_for_tests();
      const row = await verify_track_online_v2(
        {
          spotify_id: 'ambig-fallback',
          title: 'Same Title',
          artists: ['Artist A'],
          isrc: 'XX0000000001',
          duration_ms: 200500,
        },
        { fetch_fn: fetch_fn, cache: load_query_cache(), progress: load_progress() }
      );
      assert.equal(row.verify_status, 'ambiguous');
      assert.equal(row.fallback_search_used, true);
    });
  });

  test('中斷續跑：已完成曲目跳過', async function (t) {
    await with_g2_tmp(t, async function () {
      let fetch_calls = 0;
      const fetch_fn = async function (url) {
        fetch_calls += 1;
        if (url.indexOf('/isrc/') >= 0) {
          return {
            ok: true,
            status: 200,
            headers: { get: function () { return null; } },
            json: async function () {
              return {
                recordings: [
                  {
                    id: 'rec-resume',
                    title: 'Resume Song',
                    length: 180000,
                    'artist-credit': [{ name: 'Band' }],
                  },
                ],
              };
            },
          };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: function () { return null; } },
          json: async function () { return { recordings: [] }; },
        };
      };
      reset_rate_limit_clock_for_tests();
      await run_g2_verification({
        online: true,
        fetch_fn: fetch_fn,
        force: true,
        max_tracks: 1,
      });
      const calls_after_first = fetch_calls;
      await run_g2_verification({
        online: true,
        fetch_fn: fetch_fn,
        force: false,
        max_tracks: 1,
      });
      assert.equal(fetch_calls, calls_after_first);
      const ver = load_verification_results();
      const ids = Object.keys(ver.tracks);
      assert.ok(ids.length >= 1);
      assert.equal(is_verification_final(ver.tracks[ids[0]]), true);
    });
  });

  test('G2 執行不呼叫 Spotify API', async function (t) {
    await with_g2_tmp(t, async function () {
      const fetch_fn = async function (url) {
        assert.ok(url.indexOf('api.spotify.com') < 0);
        assert.ok(url.indexOf('musicbrainz.org') >= 0);
        return {
          ok: false,
          status: 404,
          headers: { get: function () { return null; } },
          json: async function () { return {}; },
        };
      };
      reset_rate_limit_clock_for_tests();
      await run_g2_verification({
        online: true,
        fetch_fn: fetch_fn,
        force: true,
        max_tracks: 1,
      });
    });
  });

  test('歧義偵測：相近分數標記', function () {
    const ranked = [
      { match_score: 72, external_id: 'a' },
      { match_score: 70, external_id: 'b' },
    ];
    assert.equal(detect_ambiguity(ranked), true);
  });
});
