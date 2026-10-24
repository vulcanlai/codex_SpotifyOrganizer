/**
 * G3-D.3 修復樣本 30 首（固定 seed）
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { FILE_G3_D2_QUALITY_OVERLAY, FILE_G3_D2_SOUNDTRACK_AUDIT } from './paths_d2.js';
import { G3_D3_SAMPLE_SEED } from './paths_d3.js';
import { build_d1_lineage_200 } from './g3_d3_lineage.js';

function rank(seed, id) {
  return crypto.createHash('sha256').update(seed + ':' + id).digest('hex');
}

function pick_sorted(ids, seed, n) {
  return ids
    .slice()
    .sort(function (a, b) {
      return rank(seed, a) < rank(seed, b) ? -1 : 1;
    })
    .slice(0, n);
}

/**
 * @param {object} ctx imported by_id, overlay by_id
 */
export function select_g3_d3_repair_sample_30(ctx) {
  const st = JSON.parse(fs.readFileSync(FILE_G3_D2_SOUNDTRACK_AUDIT, 'utf8'));
  const ov = JSON.parse(fs.readFileSync(FILE_G3_D2_QUALITY_OVERLAY, 'utf8'));
  const by_id = ctx.by_id || {};
  const ov_by = {};
  for (let i = 0; i < ov.tracks.length; i += 1) {
    ov_by[ov.tracks[i].track_id] = ov.tracks[i];
  }

  const composer_pool = (st.buckets.composer_credits_only || []).map(function (x) {
    return x.track_id;
  });
  const unk_pool = ov.tracks
    .filter(function (t) {
      return t.quality_status === 'classification_unknown';
    })
    .map(function (t) {
      return t.track_id;
    });
  const low_pool = Object.keys(by_id).filter(function (id) {
    return by_id[id].confidence_tier === 'low' && unk_pool.indexOf(id) < 0;
  });
  const unk_low_pool = unk_pool.concat(
    low_pool.filter(function (id) {
      return unk_pool.indexOf(id) < 0;
    })
  );

  const ne_other_pool = ov.tracks
    .filter(function (t) {
      const row = by_id[t.track_id];
      if (!row || t.quality_status !== 'needs_evidence') {
        return false;
      }
      const pk = row.genre_profile.primary_genre;
      return pk !== 'soundtrack_instrumental' && pk !== 'unknown';
    })
    .map(function (t) {
      return t.track_id;
    });

  const ok_pool = ov.tracks
    .filter(function (t) {
      return t.quality_status === 'quality_ok';
    })
    .map(function (t) {
      return t.track_id;
    });

  const quotas = {
    composer_only_soundtrack: 12,
    unknown_or_low: 10,
    needs_evidence_other_genre: 5,
    quality_ok_control: 3,
  };

  const picked = [];
  const used = {};
  const shortfalls = [];

  function take(pool, n, cohort, reason_zh) {
    const available = pool.filter(function (id) {
      return !used[id];
    });
    const chosen = pick_sorted(available, G3_D3_SAMPLE_SEED + ':' + cohort, n);
    if (chosen.length < n) {
      shortfalls.push(cohort + ' 需求 ' + n + ' 實得 ' + chosen.length);
    }
    for (let c = 0; c < chosen.length; c += 1) {
      used[chosen[c]] = true;
      picked.push({
        track_id: chosen[c],
        cohort: cohort,
        selection_reason_zh: reason_zh,
      });
    }
  }

  take(
    composer_pool,
    quotas.composer_only_soundtrack,
    'composer_only_soundtrack',
    'D.2 soundtrack 稽核 composer_credits_only 分桶'
  );
  take(
    unk_low_pool,
    quotas.unknown_or_low,
    'unknown_or_low',
    'D.2 classification_unknown 或 confidence_tier=low'
  );
  take(
    ne_other_pool,
    quotas.needs_evidence_other_genre,
    'needs_evidence_other_genre',
    'D.2 quality needs_evidence 且主曲風非配樂／unknown'
  );
  take(
    ok_pool,
    quotas.quality_ok_control,
    'quality_ok_control',
    'D.2 quality_ok 對照組'
  );

  return {
    seed: G3_D3_SAMPLE_SEED,
    requested_total: 30,
    actual_total: picked.length,
    shortfalls_zh: shortfalls,
    tracks: picked,
    pool_sizes: {
      composer_only: composer_pool.length,
      unknown_or_low: unk_low_pool.length,
      needs_evidence_other: ne_other_pool.length,
      quality_ok: ok_pool.length,
    },
  };
}
