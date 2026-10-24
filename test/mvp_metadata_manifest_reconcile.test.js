/**
 * metadata manifest 本機對齊（離線）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  run_mvp_metadata_manifest_reconcile,
  MVP_SPOTIFY_METADATA_SYNC_AUTHORIZE_TOKEN,
} from '../lib/classification/mvp_playlist_metadata_sync.js';
import { empty_sync_manifest, save_sync_manifest } from '../lib/classification/mvp_playlist_sync_manifest.js';

test('manifest-reconcile 不呼叫 API 仍更新 spotify_name', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvp-recon-'));
  const manifest_path = path.join(dir, 'sync-manifest.json');
  const doc = empty_sync_manifest();
  doc.playlists['emotion:relaxed_comfort'] = {
    mvp_playlist_id: 'emotion:relaxed_comfort',
    spotify_playlist_id: '5J7Tit6MPEbHhDEjnUbEr5',
    spotify_name: '🎵 輕鬆・舒服',
    sync_status: 'complete',
  };
  save_sync_manifest(doc, manifest_path);

  const out = run_mvp_metadata_manifest_reconcile({
    manifest_path: manifest_path,
    emotion_only: true,
    names_only: true,
    authorize: MVP_SPOTIFY_METADATA_SYNC_AUTHORIZE_TOKEN,
    index_doc: {
      tracks_by_id: {
        t1: {
          display: { name: 'X', artists: ['A'] },
          genre_profile: { primary_genre: 'pop' },
          tags: [{ dimension: 'context', value: '放鬆', confidence: 'inferred' }],
        },
      },
    },
  });

  assert.equal(out.results[0].status, 'reconciled_local');
  assert.equal(out.results[0].name, '🎵 輕鬆 / 舒服');
  const saved = JSON.parse(fs.readFileSync(manifest_path, 'utf8'));
  assert.equal(
    saved.playlists['emotion:relaxed_comfort'].spotify_name,
    '🎵 輕鬆 / 舒服'
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
