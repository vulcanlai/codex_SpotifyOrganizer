/**
 * 階段 G1：外部查證（離線／mock HTTP；不寫入正式試驗目錄）
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  score_candidate,
  detect_ambiguity,
  MATCH_RELIABLE_THRESHOLD,
} from '../lib/enrichment/external/match_scoring.js';
import {
  build_inference_layer,
  build_fact_layer,
} from '../lib/enrichment/external/facts_layer.js';
import {
  build_g1_sample,
  G1_MUST_INCLUDE_LEMON_TREE,
} from '../lib/enrichment/external/g1_sample.js';
import { G1_TARGET_COUNT } from '../lib/enrichment/external/paths.js';
import { mb_request, reset_rate_limit_clock_for_tests } from '../lib/enrichment/external/mb_http.js';
import { run_g1_verification } from '../lib/enrichment/external/run_verification.js';
import {
  load_verification_results,
  load_progress,
} from '../lib/enrichment/external/verification_store.js';
import {
  file_g1_sample_trial,
  file_g1_verification,
  G1_TRIAL_DIR,
  is_g1_mock_verification_row,
} from '../lib/enrichment/external/g1_path_resolve.js';
import { handle_classification_api } from '../lib/classification/web_handlers.js';
import { FILE_MANUAL_OVERRIDES } from '../lib/classification/paths.js';
import { build_g1_quality_report } from '../lib/enrichment/external/quality_report.js';
import { verification_doc_has_mock } from '../lib/enrichment/external/g1_trial_runtime.js';
import { set_verify_engine } from '../lib/enrichment/external/verify_data_dir.js';

const ENV_G1 = 'SPOTIFYORG_G1_DATA_DIR';

function file_sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function clear_g1_data_dir_env() {
  delete process.env[ENV_G1];
}

describe('G1 外部查證', { concurrency: 1 }, function () {
  test('init g1 engine', function () {
    set_verify_engine('g1');
    delete process.env.SPOTIFYORG_G2_DATA_DIR;
    delete process.env.SPOTIFYORG_G1_DATA_DIR;
  });

function with_isolated_g1_data_dir(t, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spotifyorg-g1-'));
  const prev = process.env[ENV_G1];
  process.env[ENV_G1] = tmp;
  set_verify_engine('g1');
  t.after(function () {
    if (prev === undefined) {
      delete process.env[ENV_G1];
    } else {
      process.env[ENV_G1] = prev;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  return fn(tmp);
}

test('比對：中文／英文／日文歌名皆能產生分數', function () {
  const base = {
    artists: ['Artist'],
    album_name: 'Al',
    duration_ms: 200000,
  };
  const zh = score_candidate(
    { title: '大雪', ...base },
    {
      title: '大雪',
      artist_names: ['Artist'],
      duration_ms: 201000,
    }
  );
  assert.ok(zh.match_score >= 70);
  const en = score_candidate(
    { title: 'Lemon Tree', ...base },
    {
      title: 'Lemon Tree',
      artist_names: ['Artist'],
      duration_ms: 199000,
    }
  );
  assert.ok(en.match_score >= 70);
  const ja = score_candidate(
    { title: '残酷な天使のテーゼ', ...base, artists: ['高橋洋子'] },
    {
      title: '残酷な天使のテーゼ',
      artist_names: ['高橋洋子'],
      duration_ms: 200500,
    }
  );
  assert.ok(ja.match_score >= 70);
});

test('歧義：前兩名分數接近時標記 ambiguous', function () {
  const ranked = [
    { match_score: MATCH_RELIABLE_THRESHOLD + 2 },
    { match_score: MATCH_RELIABLE_THRESHOLD },
  ];
  assert.equal(detect_ambiguity(ranked), true);
});

test('推論層：不因歌名推斷演唱語言', function () {
  const facts = build_fact_layer(
    {
      external_id: 'x',
      title: 'Lemon Tree',
      artist_names: ['蘇慧倫'],
      tags: ['pop'],
    },
    false
  );
  const inf = build_inference_layer(facts);
  assert.equal(inf.vocal_language.value, 'unknown');
  assert.equal(inf.vocal_language.confidence, 0);
});

test('G1 樣本可重現且含 Lemon Tree', function () {
  const a = build_g1_sample({ write: false });
  const b = build_g1_sample({ write: false });
  assert.deepEqual(a.sample_doc.track_ids, b.sample_doc.track_ids);
  assert.equal(a.sample_doc.track_ids.length, G1_TARGET_COUNT);
  assert.ok(a.sample_doc.track_ids.indexOf(G1_MUST_INCLUDE_LEMON_TREE) >= 0);
});

test('正式試驗目錄查證結果不含 mock 列', function () {
  assert.ok(fs.existsSync(file_g1_sample_trial()));
  const ver_path = path.join(G1_TRIAL_DIR, 'verification-results.json');
  if (!fs.existsSync(ver_path)) {
    return;
  }
  const ver = JSON.parse(fs.readFileSync(ver_path, 'utf8'));
  assert.equal(
    verification_doc_has_mock(ver),
    false,
    '正式 verification-results 仍含 mock，請執行 verify:g1-clean-mock-runtime'
  );
});

test('離線預覽不增加網路請求', async function (t) {
  await with_isolated_g1_data_dir(t, async function () {
    const mo = file_sha256(FILE_MANUAL_OVERRIDES);
    assert.ok(fs.existsSync(file_g1_sample_trial()));
    const before = load_progress().stats.network_requests;
    const result = await run_g1_verification({ online: false });
    const after = load_progress().stats.network_requests;
    assert.equal(before, after);
    assert.equal(result.previews.length, G1_TARGET_COUNT);
    assert.equal(result.skipped, 0);
    assert.equal(file_sha256(FILE_MANUAL_OVERRIDES), mo);
  });
});

test('mock MusicBrainz：僅寫入隔離目錄', async function (t) {
  await with_isolated_g1_data_dir(t, async function (tmp) {
    const trial_ver_path = path.join(G1_TRIAL_DIR, 'verification-results.json');
    const trial_ver_before = fs.existsSync(trial_ver_path)
      ? fs.readFileSync(trial_ver_path, 'utf8')
      : null;

    const target_id = G1_MUST_INCLUDE_LEMON_TREE;

    let calls = 0;
    const fetch_fn = async function (url) {
      calls += 1;
      if (url.indexOf('/isrc/') >= 0) {
        return {
          ok: true,
          status: 200,
          headers: { get: function () { return null; } },
          json: async function () {
            return {
              recordings: [
                {
                  id: 'rec-mock-1',
                  title: 'Mock Title',
                  length: 200000,
                  'artist-credit': [{ name: 'Mock Artist' }],
                  tags: [{ name: 'pop' }],
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
        json: async function () {
          return {
            recordings: [
              {
                id: 'rec-search-1',
                title: 'Search Hit',
                length: 200000,
                'artist-credit': [{ name: 'A' }],
              },
            ],
          };
        },
      };
    };

    reset_rate_limit_clock_for_tests();
    await run_g1_verification({
      online: true,
      fetch_fn: fetch_fn,
      force: true,
      max_tracks: 1,
    });
    assert.ok(calls >= 1);

    const iso_ver = JSON.parse(
      fs.readFileSync(path.join(tmp, 'verification-results.json'), 'utf8')
    );
    assert.ok(iso_ver.tracks[target_id]);
    assert.ok(is_g1_mock_verification_row(iso_ver.tracks[target_id]));

    if (trial_ver_before === null) {
      assert.ok(!fs.existsSync(trial_ver_path));
    } else {
      assert.equal(fs.readFileSync(trial_ver_path, 'utf8'), trial_ver_before);
    }
  });
});

test('429 退避：有限重試後失敗', async function () {
  reset_rate_limit_clock_for_tests();
  let n = 0;
  const fetch_fn = async function () {
    n += 1;
    return {
      ok: false,
      status: 429,
      headers: {
        get: function () {
          return '0';
        },
      },
    };
  };
  await assert.rejects(function () {
    return mb_request(fetch_fn, 'https://musicbrainz.org/ws/2/recording/?query=test&fmt=json');
  });
  assert.ok(n >= 2);
});

test('品質報告可離線產生', function () {
  const report = build_g1_quality_report({ write: false });
  assert.ok(Array.isArray(report.summary_zh));
  assert.ok(report.totals.test_track_count >= 0);
});

test('API：external-verify status', async function () {
  clear_g1_data_dir_env();
  const res = await handle_classification_api('GET', '/api/external-verify/status', '', null);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.external_verify);
});

});
