/**
 * 情緒歌單 metadata 僅改名 dry-run（離線，真實 manifest）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build_mvp_metadata_update_plan } from '../lib/classification/mvp_playlist_metadata_sync.js';
import { DEFAULT_MVP_SYNC_MANIFEST_PATH } from '../lib/classification/mvp_playlist_sync_manifest.js';

test('emotion + names-only：情緒歌單 target 含半形斜線', function () {
  const manifest_path = path.resolve(DEFAULT_MVP_SYNC_MANIFEST_PATH);
  const plan = build_mvp_metadata_update_plan({
    manifest_path: manifest_path,
    emotion_only: true,
    names_only: true,
  });
  assert.equal(plan.description_change_count, 0);
  for (let i = 0; i < plan.changes.length; i += 1) {
    assert.ok(plan.changes[i].mvp_playlist_id.indexOf('emotion:') === 0);
    assert.ok(plan.changes[i].target_name.indexOf(' / ') >= 0);
    assert.equal(plan.changes[i].target_name.indexOf('／'), -1);
  }
});
