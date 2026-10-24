/**
 * 人工分類 Web UI API（fixture／不寫正式資料）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse_spotify_id_list } from '../lib/classification/manual_classify/spotify_id_parse.js';
import { resolve_playlist_ids, load_mvp_playlist_registry } from '../lib/classification/manual_classify/mvp_playlist_resolver.js';
import {
  run_manual_classify_preview,
  run_manual_classify_apply,
  compute_manual_classify_preview_token,
  reset_manual_classify_apply_state_for_tests,
  mark_preview_token_consumed_for_tests,
  response_has_oauth_leak,
  build_manual_classify_request_from_ui,
} from '../lib/classification/manual_classify/manual_classify_web_service.js';
import {
  handle_manual_classify_api,
  is_local_manual_classify_client,
} from '../lib/classification/manual_classify/web_handlers.js';
import { empty_overrides_doc } from '../lib/classification/overrides_store.js';
import {
  album_blocks_manual_classify_apply,
  build_manual_classify_plan,
} from '../lib/classification/manual_classify/manual_classify_core.js';
import {
  MANUAL_CLASSIFY_UI_HOST,
  MANUAL_CLASSIFY_UI_PORT,
} from '../manual-classify-ui-server.js';

const FAKE_TRACK = '00000000000000000000bb';

test('1. Track URL 與 Album URL 解析（UI request）', function () {
  const track_req = build_manual_classify_request_from_ui({
    spotify_input: 'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6',
    playlist_ids: ['lg:v2:english:folk'],
  });
  assert.ok(track_req.track_tokens.indexOf('6rqhFgbbKwnb9MLmUQDhG6') >= 0);
  const album_parsed = parse_spotify_id_list(
    'https://open.spotify.com/album/14W5TKHpGghGbgFlkxfbWm'
  );
  assert.equal(album_parsed.albums[0], '14W5TKHpGghGbgFlkxfbWm');
  const album_req = build_manual_classify_request_from_ui({
    spotify_input: 'https://open.spotify.com/album/14W5TKHpGghGbgFlkxfbWm',
    playlist_ids: ['lg:v2:english:folk'],
  });
  assert.equal(album_req.album, '14W5TKHpGghGbgFlkxfbWm');
  const pure_album_req = build_manual_classify_request_from_ui({
    spotify_input: '14W5TKHpGghGbgFlkxfbWm',
    playlist_ids: ['lg:v2:english:folk'],
  });
  assert.equal(pure_album_req.album, '14W5TKHpGghGbgFlkxfbWm');
});

test('2. 不完整專輯拒絕套用', function () {
  const gate = album_blocks_manual_classify_apply({
    albums: [{ album_id: 'x', incomplete: true, ok: true, track_ids: [FAKE_TRACK] }],
  });
  assert.equal(gate.blocked, true);
});

test('3. 歌單多選：英語配樂 vs 配樂／器樂 不同 ID', function () {
  const reg = load_mvp_playlist_registry();
  const r = resolve_playlist_ids(
    ['lg:v2:english:soundtrack_instrumental', 'lg:v2:other_lang:soundtrack_instrumental'],
    reg
  );
  assert.equal(r.ok, true);
  assert.equal(r.mvp_playlist_ids.length, 2);
  assert.notEqual(r.mvp_playlist_ids[0], r.mvp_playlist_ids[1]);
});

test('4. 預覽不寫入（write 未觸發）', function () {
  const body = {
    spotify_input: FAKE_TRACK,
    spotify_id_kind: 'track',
    playlist_ids: ['lg:v2:english:folk'],
  };
  const prev = run_manual_classify_preview(body, {
    include_plan: false,
  });
  assert.ok(prev.preview_token);
  assert.equal(prev.preview.mode, 'preview_readonly');
});

test('5. 寫入須 confirm 與 preview_token', function () {
  reset_manual_classify_apply_state_for_tests();
  const body = {
    spotify_input: FAKE_TRACK,
    spotify_id_kind: 'track',
    playlist_ids: ['lg:v2:english:folk'],
  };
  const token = compute_manual_classify_preview_token(body);
  const no_confirm = run_manual_classify_apply({ preview_token: token, request: body });
  assert.equal(no_confirm.ok, false);
  const applied = run_manual_classify_apply(
    { confirm: true, preview_token: token, request: body },
    { write: false, rebuild_index: false }
  );
  assert.equal(applied.ok, true);
});

test('6. G3-F adopted 仍保留（預覽衝突提示）', function () {
  const body = {
    spotify_input: FAKE_TRACK,
    playlist_ids: ['lg:v2:english:folk'],
  };
  const preview = run_manual_classify_preview(body, {
    include_plan: false,
  });
  const plan_req = {
    track_tokens: FAKE_TRACK,
    spotify_id_kind: 'track',
    playlist_ids: ['lg:v2:english:folk'],
    primary_genre: 'folk',
    overrides_doc: empty_overrides_doc(),
    registry_doc: {
      adoptions_by_track_id: {
        [FAKE_TRACK]: { status: 'adopted' },
      },
    },
  };
  const plan = build_manual_classify_plan(plan_req);
  assert.ok(plan.tracks[0].conflicts.length >= 1);
  assert.equal(plan.tracks[0].g3_f_registry_status, 'adopted');
  assert.ok(preview.preview_token);
});

test('7. 重複 apply token 拒絕', function () {
  reset_manual_classify_apply_state_for_tests();
  const body = {
    spotify_input: FAKE_TRACK,
    spotify_id_kind: 'track',
    playlist_ids: ['lg:v2:english:folk'],
  };
  const token = compute_manual_classify_preview_token(body);
  mark_preview_token_consumed_for_tests(token);
  const second = run_manual_classify_apply(
    { confirm: true, preview_token: token, request: body },
    { write: false, rebuild_index: false }
  );
  assert.equal(second.error, 'duplicate_apply');
});

test('8. API 不回傳 OAuth 憑證', async function () {
  const health = await handle_manual_classify_api('GET', '/api/health', '', {
    remote_address: '127.0.0.1',
  });
  const health_body = JSON.parse(health.body);
  assert.equal(response_has_oauth_leak(health_body), false);
  const pl = await handle_manual_classify_api('GET', '/api/playlists', '', {
    remote_address: '127.0.0.1',
  });
  assert.equal(response_has_oauth_leak(JSON.parse(pl.body)), false);
});

test('9. 非本機 remote 403', async function () {
  const res = await handle_manual_classify_api('GET', '/api/health', '', {
    remote_address: '8.8.8.8',
  });
  assert.equal(res.status, 403);
});

test('10. 本機 bind 設定', function () {
  assert.equal(MANUAL_CLASSIFY_UI_HOST, '127.0.0.1');
  assert.equal(MANUAL_CLASSIFY_UI_PORT, 8892);
  assert.equal(is_local_manual_classify_client('127.0.0.1'), true);
});
