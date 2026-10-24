/**
 * MVP metadata 更新計畫（離線）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { build_mvp_metadata_update_plan } from '../lib/classification/mvp_playlist_metadata_sync.js';
import { empty_sync_manifest, save_sync_manifest } from '../lib/classification/mvp_playlist_sync_manifest.js';

test('metadata dry-run 比對 manifest 與目標名稱', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvp-meta-'));
  const manifest_path = path.join(dir, 'sync-manifest.json');
  const doc = empty_sync_manifest();
  doc.playlists['lg:v2:other_lang:pop'] = {
    mvp_playlist_id: 'lg:v2:other_lang:pop',
    spotify_playlist_id: 'testPlaylistId1234567890',
    spotify_name: '🎵 其他語言流行',
    sync_status: 'complete',
  };
  save_sync_manifest(doc, manifest_path);

  const plan = build_mvp_metadata_update_plan({
    manifest_path: manifest_path,
    index_doc: {
      tracks_by_id: {
        x: {
          display: { name: 'T', artists: ['A'] },
          genre_profile: { primary_genre: 'pop', confidence: 'inferred' },
          tags: [{ dimension: 'language', value: '台語', confidence: 'inferred' }],
        },
      },
    },
  });

  const ch = plan.changes.find(function (c) {
    return c.mvp_playlist_id === 'lg:v2:other_lang:pop';
  });
  assert.ok(ch);
  assert.equal(ch.target_name, '🎵 流行音樂');
  assert.equal(ch.update_name, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
