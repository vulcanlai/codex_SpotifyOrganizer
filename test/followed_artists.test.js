/**
 * 追蹤藝人備份離線測試
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalize_followed_artist,
  dedupe_followed_artists,
} from '../lib/artists/normalize.js';
import {
  collect_all_followed_artists,
  FollowedArtistsPaginationError,
} from '../lib/artists/fetch_followed.js';
import {
  should_replace_followed_artists_file,
  detect_unfollowed_since_last,
} from '../lib/artists/storage.js';
import { SpotifyRequestError } from '../lib/spotify_api.js';
import { write_json_atomic } from '../lib/atomic_json.js';

test('normalize_followed_artist：缺欄位不拋錯、無 followed_at', function () {
  const row = normalize_followed_artist({ name: 'X' }, 0);
  assert.equal(row.artist_id, null);
  assert.equal(row.name, 'X');
  assert.equal(row.source, 'followed_artist');
  assert.ok(!('followed_at' in row));
});

test('dedupe_followed_artists：重複 id 只保留一筆', function () {
  const rows = dedupe_followed_artists([
    { artist_id: 'a1', name: 'A' },
    { artist_id: 'a1', name: 'A dup' },
    { artist_id: 'a2', name: 'B' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'A');
});

test('collect_all_followed_artists：空清單單頁完成', async function () {
  const result = await collect_all_followed_artists(async function () {
    return {
      artists: {
        items: [],
        total: 0,
        next: null,
        cursors: { after: null },
      },
    };
  });
  assert.equal(result.pagination_complete, true);
  assert.equal(result.items.length, 0);
  assert.equal(result.pages, 1);
});

test('collect_all_followed_artists：cursor 兩頁', async function () {
  let call = 0;
  const result = await collect_all_followed_artists(async function (after) {
    call += 1;
    if (after === null) {
      return {
        artists: {
          items: [{ id: 'a1' }, { id: 'a2' }],
          total: 3,
          next: 'https://api.spotify.com/v1/me/following?after=c1',
          cursors: { after: 'c1' },
        },
      };
    }
    return {
      artists: {
        items: [{ id: 'a3' }],
        total: 3,
        next: null,
        cursors: { after: null },
      },
    };
  });
  assert.equal(result.items.length, 3);
  assert.equal(result.pages, 2);
  assert.equal(result.pagination_complete, true);
});

test('collect_all_followed_artists：cursor 重複拋錯', async function () {
  await assert.rejects(
    collect_all_followed_artists(async function () {
      return {
        artists: {
          items: [{ id: 'a1' }],
          total: 10,
          next: 'https://x',
          cursors: { after: 'same' },
        },
      };
    }),
    FollowedArtistsPaginationError
  );
});

test('collect_all_followed_artists：有 next 無 after 拋錯', async function () {
  await assert.rejects(
    collect_all_followed_artists(async function () {
      return {
        artists: {
          items: [{ id: 'a1' }],
          total: 10,
          next: 'https://x',
          cursors: {},
        },
      };
    }),
    FollowedArtistsPaginationError
  );
});

test('should_replace：失敗不覆蓋', function () {
  const existing = { pagination_complete: true, artists: [] };
  assert.equal(
    should_replace_followed_artists_file(
      { pagination_complete: false, fetch_failed: true },
      existing
    ),
    false
  );
  assert.equal(
    should_replace_followed_artists_file(
      { pagination_complete: true, fetch_failed: false },
      existing
    ),
    true
  );
});

test('detect_unfollowed：完整比對後列出消失 id', function () {
  const prev = {
    artists: [{ artist_id: 'a1' }, { artist_id: 'a2' }],
  };
  const next = [{ artist_id: 'a2' }, { artist_id: 'a3' }];
  const info = detect_unfollowed_since_last(prev, next);
  assert.equal(info.compared, true);
  assert.deepEqual(info.unfollowed_artist_ids, ['a1']);
});

test('write_json_atomic：寫入有效 JSON', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-artists-'));
  const file = path.join(dir, 'test.json');
  write_json_atomic(file, { ok: true, n: 1 });
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('模擬 API 403：fetch_page 拋 SpotifyRequestError', async function () {
  await assert.rejects(
    collect_all_followed_artists(async function () {
      throw new SpotifyRequestError('禁止存取（403）', 403);
    }),
    SpotifyRequestError
  );
});

test('模擬分頁中斷：第二頁失敗', async function () {
  let pages = 0;
  await assert.rejects(
    collect_all_followed_artists(async function (after) {
      if (after === null) {
        pages += 1;
        return {
          artists: {
            items: [{ id: 'a1' }],
            total: 2,
            next: 'https://x',
            cursors: { after: 'c2' },
          },
        };
      }
      throw new SpotifyRequestError('429', 429, null, 2);
    }),
    SpotifyRequestError
  );
  assert.equal(pages, 1);
});
