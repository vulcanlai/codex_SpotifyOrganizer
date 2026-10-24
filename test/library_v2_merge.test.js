/**
 * library-v2 合併離線測試
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  push_appearance_unique,
  appearance_fingerprint,
} from '../lib/merge/v2/appearances.js';
import {
  merge_track_metadata,
  is_weak_metadata_value,
  compute_metadata_stats,
} from '../lib/merge/v2/metadata_merge.js';
import {
  build_library_v2_from_sources,
  verify_v1_preserved,
} from '../lib/merge/v2/build_library_v2.js';
import { MergeV2SourceError } from '../lib/merge/v2/validate_sources.js';

test('appearance 指紋：重複執行不重複加入', function () {
  const apps = [];
  const a = {
    kind: 'saved_album',
    album_id: 'alb1',
    position: 0,
    source: 'saved_album',
  };
  assert.equal(push_appearance_unique(apps, a), true);
  assert.equal(push_appearance_unique(apps, a), false);
  assert.equal(apps.length, 1);
  assert.equal(appearance_fingerprint(a), appearance_fingerprint({ ...a }));
});

test('跨播放清單同 ID 保留兩筆 appearance', function () {
  const index_v1 = {
    t1: {
      spotify_id: 't1',
      uri: 'spotify:track:t1',
      name: 'A',
      artists: [],
      appearances: [
        { kind: 'playlist', playlist_id: 'p1', position: 0, source: 'manual_import' },
        { kind: 'playlist', playlist_id: 'p2', position: 0, source: 'manual_import' },
      ],
    },
  };
  const index_v2 = {
    t1: {
      spotify_id: 't1',
      uri: 'spotify:track:t1',
      name: 'A',
      artists: [],
      appearances: index_v1.t1.appearances.slice(),
    },
  };
  verify_v1_preserved(index_v1, index_v2);
  assert.equal(index_v2.t1.appearances.length, 2);
});

test('metadata：null 不覆蓋既有歌名', function () {
  const row = { spotify_id: 'x', name: 'Real', artists: [] };
  const conflicts = [];
  merge_track_metadata(row, { name: null, artists: [] }, 'test', conflicts);
  assert.equal(row.name, 'Real');
  assert.equal(conflicts.length, 0);
});

test('metadata：衝突記錄', function () {
  const row = { spotify_id: 'x', name: 'A', artists: [] };
  const conflicts = [];
  merge_track_metadata(row, { name: 'B', artists: [] }, 'album', conflicts);
  assert.equal(row.name, 'A');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, 'name');
});

test('相同歌名不同 ID 不合併', function () {
  const sources = minimal_sources({
    index: {
      a: track_entry('a', 'Same Title'),
      b: track_entry('b', 'Same Title'),
    },
    albums: [],
    album_tracks: [],
  });
  const built = build_library_v2_from_sources(sources);
  const idx = built.library_v2_doc.track_index_by_spotify_id;
  assert.equal(Object.keys(idx).length, 2);
});

test('歌單與專輯同 ID 聚合 appearance', function () {
  const sources = minimal_sources({
    index: {
      shared: {
        spotify_id: 'shared',
        uri: 'spotify:track:shared',
        name: 'Hit',
        artists: ['X'],
        appearances: [
          { kind: 'playlist', playlist_id: 'pl1', position: 0, source: 'api_backup' },
        ],
      },
    },
    album_tracks: [
      {
        album_id: 'alb1',
        album_name: 'Alb',
        read_status: 'ok',
        tracks: [
          {
            spotify_id: 'shared',
            position: 0,
            disc_number: 1,
            track_number: 1,
            name: 'Hit',
            artists: [{ id: 'ar1', name: 'X' }],
            source: 'saved_album',
          },
        ],
      },
    ],
    saved_albums: [
      {
        album_id: 'alb1',
        name: 'Alb',
        tracks_read_status: 'ok',
        tracks_fetched_count: 1,
        tracks_api_total: 1,
      },
    ],
  });
  const built = build_library_v2_from_sources(sources);
  const tr = built.library_v2_doc.track_index_by_spotify_id.shared;
  assert.equal(tr.appearances.length, 2);
  assert.ok(
    tr.appearances.some(function (a) {
      return a.kind === 'saved_album';
    })
  );
});

test('按讚與專輯同 ID', function () {
  const sources = minimal_sources({
    index: {
      lik: {
        spotify_id: 'lik',
        uri: 'spotify:track:lik',
        name: 'L',
        artists: [],
        appearances: [{ kind: 'liked', position: 0, source: 'liked' }],
      },
    },
    album_tracks: [
      {
        album_id: 'alb2',
        read_status: 'ok',
        tracks: [{ spotify_id: 'lik', position: 0, source: 'saved_album' }],
      },
    ],
    saved_albums: [
      {
        album_id: 'alb2',
        tracks_read_status: 'ok',
        tracks_fetched_count: 1,
        tracks_api_total: 1,
      },
    ],
  });
  const built = build_library_v2_from_sources(sources);
  assert.equal(
    built.library_v2_doc.track_index_by_spotify_id.lik.appearances.length,
    2
  );
});

test('來源 schema 錯誤：index 非物件', function () {
  const sources = minimal_sources({});
  sources.library_v1.track_index_by_spotify_id = [];
  assert.throws(function () {
    build_library_v2_from_sources(sources);
  }, MergeV2SourceError);
});

test('來源完整性：專輯 read_status 非 ok', function () {
  const sources = minimal_sources({
    album_tracks: [{ album_id: 'a1', read_status: 'failed', tracks: [] }],
    saved_albums: [{ album_id: 'a1', tracks_read_status: 'failed' }],
  });
  assert.throws(function () {
    build_library_v2_from_sources(sources);
  }, MergeV2SourceError);
});

test('缺少 Spotify ID 的專輯曲目阻擋 complete', function () {
  const sources = minimal_sources({
    album_tracks: [
      {
        album_id: 'a1',
        read_status: 'ok',
        tracks: [{ position: 0, name: 'no id' }],
      },
    ],
    saved_albums: [
      {
        album_id: 'a1',
        tracks_read_status: 'ok',
        tracks_fetched_count: 1,
        tracks_api_total: 1,
      },
    ],
  });
  sources.library_summary.counts.total_track_entries = 1;
  assert.throws(function () {
    build_library_v2_from_sources(sources);
  }, MergeV2SourceError);
});

test('compute_metadata_stats', function () {
  const stats = compute_metadata_stats({
    a: {
      spotify_id: 'a',
      name: 'N',
      artists: ['X'],
      release_date: '2020',
      playability_status: 'playable',
    },
    b: { spotify_id: 'b', playability_status: 'unknown' },
  });
  assert.equal(stats.with_name, 1);
  assert.equal(stats.id_only, 1);
  assert.equal(stats.playability_unknown, 1);
});

test('is_weak_metadata_value', function () {
  assert.equal(is_weak_metadata_value(null), true);
  assert.equal(is_weak_metadata_value('unknown'), true);
  assert.equal(is_weak_metadata_value('Title'), false);
});

/**
 * @param {object} opts
 */
function minimal_sources(opts) {
  const index = opts.index || {
    t1: track_entry('t1', 'One'),
  };
  const album_tracks = opts.album_tracks || [];
  const saved_albums = opts.saved_albums || [];
  let album_track_rows = 0;
  for (let i = 0; i < album_tracks.length; i += 1) {
    const sec = album_tracks[i];
    if (sec.tracks) {
      album_track_rows += sec.tracks.length;
    }
  }

  return {
    library_v1: {
      schema_version: 1,
      user_id: 'u1',
      playlist_track_entries: [{ spotify_id: 't1' }],
      liked_tracks: [],
      track_index_by_spotify_id: index,
    },
    merge_summary_v1: {
      schema_version: 1,
      library_data_complete: true,
      counts: {
        playlist_track_entries_total: 1,
        liked_tracks: 0,
        unique_tracks_by_spotify_id: Object.keys(index).length,
      },
    },
    saved_albums_doc: {
      schema_version: 1,
      albums: saved_albums,
    },
    album_tracks_doc: {
      schema_version: 1,
      albums: album_tracks,
    },
    library_summary: {
      schema_version: 1,
      library_albums_backup_complete: true,
      counts: {
        total_track_entries: album_track_rows,
        albums_in_backup: saved_albums.length,
      },
    },
    followed_artists_doc: {
      schema_version: 1,
      pagination_complete: true,
      artists: [{ artist_id: 'ar1', name: 'Artist' }],
    },
    followed_summary: {
      schema_version: 1,
      followed_artists_backup_complete: true,
    },
  };
}

function track_entry(id, name) {
  return {
    spotify_id: id,
    uri: `spotify:track:${id}`,
    name,
    artists: [],
    appearances: [{ kind: 'playlist', playlist_id: 'p', position: 0, source: 'api_backup' }],
  };
}
