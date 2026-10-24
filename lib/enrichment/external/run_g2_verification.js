/**
 * G2 外部查證執行（預設離線；結果寫入 g2-30，不覆寫 G1）
 */
import { VERIFY_STATUS } from './paths.js';
import { set_verify_engine } from './verify_data_dir.js';
import {
  verify_track_online_v2,
  preview_track_offline,
} from './verify_engine.js';
import {
  load_query_cache,
  save_query_cache,
  load_verification_results,
  save_verification_results,
  load_progress,
  save_progress,
  build_track_result_row,
  is_verification_final,
  empty_verification_doc,
} from './verification_store.js';
import { build_external_track_input } from './track_input.js';
import { load_g1_trial_sample } from './g1_sample.js';
import { musicbrainz_provider } from './musicbrainz_provider.js';
import {
  build_fact_layer,
  build_inference_layer,
} from './facts_layer.js';

export const G2_SAMPLE_ID = 'g2-ext-verify-v1';

/**
 * @param {{ online?: boolean, fetch_fn?: typeof fetch, force?: boolean, max_tracks?: number }} opts
 */
export async function run_g2_verification(opts) {
  set_verify_engine('g2');
  const options = opts || {};
  const online = !!options.online;
  const fetch_fn = options.fetch_fn || fetch;
  const force = !!options.force;
  const max_tracks =
    typeof options.max_tracks === 'number' ? options.max_tracks : 30;

  const sample = load_g1_trial_sample();
  if (!sample) {
    throw new Error('缺少 G1 sample-30.json（G2 沿用同樣本），請先 npm run verify:g1-build-sample');
  }

  let ver = load_verification_results();
  if (!ver.sample_id || force) {
    ver = empty_verification_doc(sample);
    ver.sample_id = G2_SAMPLE_ID;
    ver.based_on_g1_sample_id = sample.sample_id;
    ver.verify_engine = 'g2';
  }

  let progress = load_progress();
  progress.mode = online ? 'online' : 'offline';
  progress.verify_engine = 'g2';
  const cache = load_query_cache();

  const ctx = {
    fetch_fn: fetch_fn,
    cache: cache,
    progress: progress,
  };

  const ids = sample.track_ids.slice(0, max_tracks);
  const previews = [];
  let processed = 0;
  let skipped = 0;

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const existing = ver.tracks[id];
    if (!force && is_verification_final(existing)) {
      skipped += 1;
      continue;
    }

    const input = build_external_track_input(id);
    if (!input) {
      continue;
    }

    if (!online) {
      previews.push(preview_track_offline(input, 'g2'));
      continue;
    }

    try {
      const row = await verify_track_online_v2(input, ctx);
      ver.tracks[id] = row;
      processed += 1;
      if (progress.completed_ids.indexOf(id) === -1) {
        progress.completed_ids.push(id);
      }
      save_verification_results(ver);
      save_query_cache(ctx.cache);
      save_progress(progress);
    } catch (err) {
      const retryable = !!(err && (err.retryable || err.code === 'MB_RATE_LIMIT' || err.code === 'MB_NETWORK'));
      progress.stats.errors += 1;
      progress.last_error = {
        spotify_id: id,
        message: err && err.message ? err.message : String(err),
        retryable: retryable,
        at: new Date().toISOString(),
      };
      ver.tracks[id] = build_track_result_row(input, {
        provider: musicbrainz_provider.id,
        verify_status: VERIFY_STATUS.error,
        version_ambiguous: false,
        best_match: null,
        candidates: [],
        facts: build_fact_layer(null, false),
        inference: build_inference_layer(build_fact_layer(null, false)),
        unknown: {
          reasons: [
            retryable ? '暫時性外部來源錯誤（可重試）' : '外部來源請求失敗',
          ],
        },
        query_keys_used: [],
        verify_engine: 'g2',
        match_tier: 'none',
        match_tier_note: retryable ? '可重試，非查無歌曲' : null,
        isrc_conflict: false,
        fallback_search_used: false,
      });
      save_verification_results(ver);
      save_progress(progress);
    }
  }

  if (!online) {
    progress.pending_ids = ids.filter(function (sid) {
      return !is_verification_final(ver.tracks[sid]);
    });
    save_progress(progress);
  }

  return {
    online: online,
    previews: previews,
    processed: processed,
    skipped: skipped,
    progress: progress,
    verification: ver,
  };
}

export function get_g2_status_summary() {
  set_verify_engine('g2');
  const sample = load_g1_trial_sample();
  const ver = load_verification_results();
  const progress = load_progress();
  const ids = sample ? sample.track_ids : [];
  let final_n = 0;
  for (let i = 0; i < ids.length; i += 1) {
    if (is_verification_final(ver.tracks[ids[i]])) {
      final_n += 1;
    }
  }
  return {
    sample_loaded: !!sample,
    sample_id: G2_SAMPLE_ID,
    track_count: ids.length,
    verified_final_count: final_n,
    progress: progress,
    verify_engine: 'g2',
  };
}
