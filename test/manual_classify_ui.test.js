/**
 * 人工分類 Web UI API（fixture／不寫正式資料）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse_spotify_id_list } from '../lib/classification/manual_classify/spotify_id_parse.js';
import { resolve_playlist_ids } from '../lib/classification/manual_classify/mvp_playlist_resolver.js';
import {
  run_manual_classify_preview,
  run_manual_classify_apply,
  reset_manual_classify_apply_state_for_tests,
  mark_preview_token_consumed_for_tests,
  response_has_oauth_leak,
  build_manual_classify_request_from_ui,
} from '../lib/classification/manual_classify/manual_classify_web_service.js';
import {
  MvpPlaylistRegistryPathError,
  load_mvp_playlist_registry,
} from '../lib/classification/manual_classify/mvp_playlist_resolver.js';
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

test('5. 寫入須 confirm 與伺服器 preview_token', function () {
  reset_manual_classify_apply_state_for_tests();
  const body = {
    spotify_input: FAKE_TRACK,
    spotify_id_kind: 'track',
    playlist_ids: ['lg:v2:english:folk'],
  };
  const prev = run_manual_classify_preview(body);
  assert.equal(prev.ok, true);
  const no_confirm = run_manual_classify_apply({
    preview_token: prev.preview_token,
    request: body,
  });
  assert.equal(no_confirm.ok, false);
  const applied = run_manual_classify_apply(
    {
      confirm: true,
      preview_token: prev.preview_token,
      overrides_fingerprint: prev.preview.overrides_fingerprint,
      request: body,
    },
    { write: false, rebuild_index: false }
  );
  assert.ok(applied.ok === true || applied.result === 'no_changes');
});

test('5b. 未經 Preview 的 SHA-256 風格 token 拒絕', function () {
  reset_manual_classify_apply_state_for_tests();
  const body = {
    spotify_input: FAKE_TRACK,
    spotify_id_kind: 'track',
    playlist_ids: ['lg:v2:english:folk'],
  };
  const forged =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const res = run_manual_classify_apply(
    {
      confirm: true,
      preview_token: forged,
      overrides_fingerprint: '0000000000000000000000000000000000000000000000000000000000000000',
      request: body,
    },
    { write: false, rebuild_index: false }
  );
  assert.equal(res.ok, false);
  assert.equal(res.error, 'invalid_preview_token');
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
  const prev = run_manual_classify_preview(body);
  mark_preview_token_consumed_for_tests(prev.preview_token);
  const second = run_manual_classify_apply(
    {
      confirm: true,
      preview_token: prev.preview_token,
      overrides_fingerprint: prev.preview.overrides_fingerprint,
      request: body,
    },
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

test('11. 正常 preview → apply（API 層）', async function () {
  reset_manual_classify_apply_state_for_tests();
  const request = {
    spotify_input: FAKE_TRACK,
    spotify_id_kind: 'track',
    playlist_ids: ['lg:v2:english:folk'],
  };
  const preview_res = await handle_manual_classify_api(
    'POST',
    '/api/preview',
    JSON.stringify(request),
    { remote_address: '127.0.0.1' }
  );
  assert.equal(preview_res.status, 200);
  const preview_body = JSON.parse(preview_res.body);
  assert.ok(preview_body.preview_token);
  const apply_res = await handle_manual_classify_api(
    'POST',
    '/api/apply',
    JSON.stringify({
      confirm: true,
      preview_token: preview_body.preview_token,
      overrides_fingerprint: preview_body.preview.overrides_fingerprint || '',
      request: request,
    }),
    { remote_address: '127.0.0.1' }
  );
  assert.ok(apply_res.status === 200 || apply_res.status === 400);
  const apply_body = JSON.parse(apply_res.body);
  assert.notEqual(apply_body.error, 'preview_token_mismatch');
  assert.notEqual(apply_body.error, 'untrusted_fields');
});

test('12. preview 後 request 遭篡改拒絕', async function () {
  reset_manual_classify_apply_state_for_tests();
  const request = {
    spotify_input: FAKE_TRACK,
    spotify_id_kind: 'track',
    playlist_ids: ['lg:v2:english:folk'],
  };
  const preview_res = await handle_manual_classify_api(
    'POST',
    '/api/preview',
    JSON.stringify(request),
    { remote_address: '127.0.0.1' }
  );
  const preview_body = JSON.parse(preview_res.body);
  const tampered = {
    confirm: true,
    preview_token: preview_body.preview_token,
    overrides_fingerprint: preview_body.preview.overrides_fingerprint,
    request: {
      spotify_input: FAKE_TRACK,
      spotify_id_kind: 'track',
      playlist_ids: ['lg:v2:english:soundtrack_instrumental'],
    },
  };
  const apply_res = await handle_manual_classify_api(
    'POST',
    '/api/apply',
    JSON.stringify(tampered),
    { remote_address: '127.0.0.1' }
  );
  assert.equal(apply_res.status, 400);
  const apply_body = JSON.parse(apply_res.body);
  assert.equal(apply_body.error, 'preview_token_mismatch');
});

test('13. client 提供 overrides_doc／registry_doc 拒絕', async function () {
  const body = {
    spotify_input: FAKE_TRACK,
    spotify_id_kind: 'track',
    playlist_ids: ['lg:v2:english:folk'],
    overrides_doc: empty_overrides_doc(),
    registry_doc: { adoptions_by_track_id: {} },
  };
  const preview_res = await handle_manual_classify_api(
    'POST',
    '/api/preview',
    JSON.stringify(body),
    { remote_address: '127.0.0.1' }
  );
  assert.equal(preview_res.status, 400);
  const preview_json = JSON.parse(preview_res.body);
  assert.equal(preview_json.error, 'untrusted_fields');
  assert.ok(preview_json.forbidden_keys.indexOf('overrides_doc') >= 0);
  assert.ok(preview_json.forbidden_keys.indexOf('registry_doc') >= 0);

  const svc = run_manual_classify_preview(body);
  assert.equal(svc.ok, false);
  assert.equal(svc.error, 'untrusted_fields');
});

test('14. client 提供任意檔案路徑拒絕', async function () {
  const cases = [
    { album_tracks_path: 'C:\\Windows\\win.ini' },
    { catalog_path: 'D:\\SpotifyOrganizer\\.env' },
    { manifest_path: '../.env' },
  ];
  for (let i = 0; i < cases.length; i += 1) {
    const body = Object.assign(
      {
        spotify_input: FAKE_TRACK,
        spotify_id_kind: 'track',
        playlist_ids: ['lg:v2:english:folk'],
      },
      cases[i]
    );
    const res = await handle_manual_classify_api(
      'POST',
      '/api/preview',
      JSON.stringify(body),
      { remote_address: '127.0.0.1' }
    );
    assert.equal(res.status, 400, JSON.stringify(cases[i]));
    const json = JSON.parse(res.body);
    assert.equal(json.error, 'untrusted_fields');
  }
});

test('15. 合法 Web UI 請求形狀（build_manual_classify_request_from_ui）', function () {
  const ui_shape = {
    spotify_input: 'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6',
    playlist_ids: ['lg:v2:english:folk'],
  };
  const req = build_manual_classify_request_from_ui(ui_shape);
  assert.ok(req.track_tokens.indexOf('6rqhFgbbKwnb9MLmUQDhG6') >= 0);
  assert.deepEqual(req.playlist_ids, ['lg:v2:english:folk']);
  assert.equal('overrides_doc' in req, false);
  assert.equal('registry_doc' in req, false);
  assert.equal('album_tracks_path' in req, false);
});

test('16. 非法 catalog_path 拋出明確錯誤', function () {
  assert.throws(
    function () {
      load_mvp_playlist_registry({ catalog_path: 'C:\\Windows\\win.ini' });
    },
    function (err) {
      return err instanceof MvpPlaylistRegistryPathError;
    }
  );
});

test('17. 合法 CLI：無參數 load registry', function () {
  const reg = load_mvp_playlist_registry();
  assert.ok(Array.isArray(reg.entries));
  assert.ok(reg.entries.length > 0);
});
