/**
 * G3-D.5 高風險抽查 40 首（固定 seed）
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { FILE_G3_D4_COMPARISON_200 } from './paths_d4.js';
import { FILE_G3_D2_QUALITY_OVERLAY } from './paths_d2.js';
import { build_d1_lineage_200 } from './g3_d3_lineage.js';
import { G3_D5_SPOT_SEED, G3_D5_SPOT_SIZE } from './paths_d5.js';

function rank(seed, id) {
  return crypto.createHash('sha256').update(seed + ':' + id).digest('hex');
}

function pick(pool, seed, n, used) {
  const avail = pool.filter(function (id) {
    return !used[id];
  });
  return avail
    .slice()
    .sort(function (a, b) {
      return rank(seed, a) < rank(seed, b) ? -1 : 1;
    })
    .slice(0, n);
}

/**
 * @param {string[]} all_ids
 */
export function select_spot_check_40(all_ids) {
  const comp = JSON.parse(fs.readFileSync(FILE_G3_D4_COMPARISON_200, 'utf8'));
  const ov = JSON.parse(fs.readFileSync(FILE_G3_D2_QUALITY_OVERLAY, 'utf8'));
  const lin = build_d1_lineage_200();
  const lin_by = {};
  for (let i = 0; i < lin.tracks.length; i += 1) {
    lin_by[lin.tracks[i].track_id] = lin.tracks[i];
  }
  const ov_by = {};
  for (let j = 0; j < ov.tracks.length; j += 1) {
    ov_by[ov.tracks[j].track_id] = ov.tracks[j];
  }

  const used = {};
  /** @type {object[]} */
  const picked = [];
  const shortfalls = [];

  function take(pool, n, cohort, reason_zh) {
    const chosen = pick(pool, G3_D5_SPOT_SEED + ':' + cohort, n, used);
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

  const primary_changed = [];
  const soundtrack = [];
  const composer_rule = [];
  const unknown_improved = [];
  const language_changed = [];
  const confidence_up = [];
  const version_unc = [];
  const d2_needs = [];
  const same_primary_control = [];

  for (let p = 0; p < comp.per_track.length; p += 1) {
    const row = comp.per_track[p];
    if (row.missing_agent_candidate) {
      continue;
    }
    const id = row.track_id;
    if (row.deltas && row.deltas.primary_changed) {
      primary_changed.push(id);
    }
    if (row.d34 && row.d34.primary === 'soundtrack_instrumental') {
      soundtrack.push(id);
    }
    const lin_row = lin_by[id];
    if (
      lin_row &&
      (lin_row.inference_source_kind === 'rule_heuristic_soundtrack_branch' ||
        (row.d1 && row.d1.reason_zh && row.d1.reason_zh.indexOf('作曲') >= 0))
    ) {
      composer_rule.push(id);
    }
    if (row.deltas && row.deltas.unknown_improved) {
      unknown_improved.push(id);
    }
    if (row.d1 && row.d34 && row.d1.language !== row.d34.language) {
      language_changed.push(id);
    }
    if (
      row.d1 &&
      row.d34 &&
      row.d1.tier === 'low' &&
      (row.d34.tier === 'medium' || row.d34.tier === 'high')
    ) {
      confidence_up.push(id);
    }
    if (ov_by[id] && ov_by[id].quality_status === 'needs_evidence') {
      d2_needs.push(id);
    }
    if (row.deltas && !row.deltas.primary_changed) {
      same_primary_control.push(id);
    }
  }

  // version_unc from merged - loaded later in spot_check build

  const quotas = {
    primary_changed: 8,
    soundtrack_instrumental: 8,
    composer_or_artist_heuristic: 6,
    unknown_improved: 6,
    language_changed: 4,
    confidence_up_sparse: 3,
    version_uncertainty: 2,
    d2_needs_evidence: 4,
    same_primary_control: 3,
  };

  take(primary_changed, quotas.primary_changed, 'primary_changed', 'D.1 vs D.3/D.4 主曲風不同');
  take(soundtrack, quotas.soundtrack_instrumental, 'soundtrack_instrumental', '新候選為配樂／器樂');
  take(composer_rule, quotas.composer_or_artist_heuristic, 'composer_or_artist_heuristic', 'D.1 配樂／作曲者 heuristic 命中');
  take(unknown_improved, quotas.unknown_improved, 'unknown_improved', '原 unknown 改具體曲風');
  take(language_changed, quotas.language_changed, 'language_changed', '演唱語言改變');
  take(confidence_up, quotas.confidence_up_sparse, 'confidence_up_sparse', 'confidence 提高');
  take(d2_needs, quotas.d2_needs_evidence, 'd2_needs_evidence', 'D.2 v2 needs_evidence');
  take(same_primary_control, quotas.same_primary_control, 'same_primary_control', '主曲風相同對照');

  // fill to 40 if short from version_unc pool - done in spot_check with merged rows

  if (picked.length > G3_D5_SPOT_SIZE) {
    picked.length = G3_D5_SPOT_SIZE;
  }
  if (picked.length < G3_D5_SPOT_SIZE) {
    const remain = G3_D5_SPOT_SIZE - picked.length;
    take(
      all_ids,
      remain,
      'fill_balance',
      '配額未滿以 seed 補齊（仍不含已選 ID）'
    );
  }

  return {
    seed: G3_D5_SPOT_SEED,
    requested: G3_D5_SPOT_SIZE,
    actual: picked.length,
    shortfalls_zh: shortfalls,
    tracks: picked,
    pool_sizes: {
      primary_changed: primary_changed.length,
      soundtrack: soundtrack.length,
      composer_rule: composer_rule.length,
      unknown_improved: unknown_improved.length,
      language_changed: language_changed.length,
      confidence_up: confidence_up.length,
      d2_needs: d2_needs.length,
      same_primary_control: same_primary_control.length,
    },
  };
}
