/**
 * Track API 預算計數
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  create_track_api_budget,
  assert_track_api_budget,
  is_track_catalog_api_url,
  TrackApiBudgetExhaustedError,
} from '../lib/enrichment/track_api_budget.js';

test('is_track_catalog_api_url 辨識曲目端點', function () {
  assert.equal(
    is_track_catalog_api_url('https://api.spotify.com/v1/tracks/abc'),
    true
  );
  assert.equal(is_track_catalog_api_url('/v1/me/tracks?limit=50'), false);
});

test('預算精確限制 3 次', function () {
  const budget = create_track_api_budget(3);
  assert.equal(budget.try_consume(), true);
  assert.equal(budget.try_consume(), true);
  assert.equal(budget.try_consume(), true);
  assert.equal(budget.try_consume(), false);
  assert.equal(budget.consumed(), 3);
});

test('assert_track_api_budget 用盡時拋錯', function () {
  const budget = create_track_api_budget(1);
  budget.try_consume();
  assert.throws(function () {
    assert_track_api_budget('/v1/tracks/abc', { track_api_budget: budget });
  }, TrackApiBudgetExhaustedError);
});

test('非 track 端點不消耗預算', function () {
  const budget = create_track_api_budget(1);
  assert_track_api_budget('/v1/me', { track_api_budget: budget });
  assert.equal(budget.consumed(), 0);
});

test('預算精確限制 2000 次 Track API attempts', function () {
  const budget = create_track_api_budget(2000);
  for (let i = 0; i < 2000; i += 1) {
    assert.equal(budget.try_consume(), true, `attempt ${i + 1}`);
  }
  assert.equal(budget.try_consume(), false);
  assert.equal(budget.consumed(), 2000);
  assert.equal(budget.remaining(), 0);
});
