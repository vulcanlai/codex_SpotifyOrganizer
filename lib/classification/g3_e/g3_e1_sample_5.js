/**
 * G3-E.1 五首試驗清單（固定）
 */
import fs from 'node:fs';
import { FILE_G3_D5_PROVENANCE } from '../g3_d/paths_d5.js';
import { FILE_G3_D5_ELIGIBILITY } from '../g3_d/paths_d5.js';
import { G3_E1_PILOT_SEED } from './paths_e1.js';

/**
 * 固定 5 首（重疊條件已記錄於 selection_reason_zh）
 */
export function select_g3_e1_pilot_5() {
  const prov = JSON.parse(fs.readFileSync(FILE_G3_D5_PROVENANCE, 'utf8'));
  const el = JSON.parse(fs.readFileSync(FILE_G3_D5_ELIGIBILITY, 'utf8'));
  const prov_by = {};
  for (let i = 0; i < prov.tracks.length; i += 1) {
    prov_by[prov.tracks[i].track_id] = prov.tracks[i];
  }

  const tracks = [
    {
      track_id: '2ENeL62SA94IHbCokT5U2W',
      cohort: 'provenance_unverified',
      selection_reason_zh:
        'D.5 provenance_unverified（build_batches_04_17）；D.1 unknown；D.34 改 rock；兼 originally unknown',
    },
    {
      track_id: '0ZOgcAy8cOw7xSWp6IjSfC',
      cohort: 'provenance_unverified_composer_heuristic',
      selection_reason_zh:
        'D.5 provenance_unverified；D.1 composer-only soundtrack heuristic；遊戲作曲者 Lorien Testard',
    },
    {
      track_id: '680YpUhUvGBLMRQpbuxy1Q',
      cohort: 'composer_only_soundtrack',
      selection_reason_zh: 'D.2 composer_credits_only 稽核桶；D.3 修復樣本；D.1 配樂 heuristic',
    },
    {
      track_id: '6uIXIZmKdEswGUpHJeNSkk',
      cohort: 'originally_unknown',
      selection_reason_zh: 'D.1 fallback unknown；Milva；D.4 batch01 模組（非本 cohort 之 unverified 需求）',
    },
    {
      track_id: '7rIovIsXE6kMn629b7kDig',
      cohort: 'eligibility_a_control',
      selection_reason_zh: 'G3-D.5 A 類 quality_ok；Gloria Gaynor；D.3 修復',
    },
  ];

  const ids = tracks.map(function (t) {
    return t.track_id;
  });
  const set = {};
  for (let j = 0; j < ids.length; j += 1) {
    if (set[ids[j]]) {
      throw new Error('重複 ID');
    }
    set[ids[j]] = true;
  }

  let unverified_n = 0;
  for (let u = 0; u < tracks.length; u += 1) {
    const p = prov_by[tracks[u].track_id];
    if (p && p.provenance_status === 'provenance_unverified') {
      unverified_n += 1;
    }
  }
  if (unverified_n < 2) {
    throw new Error('provenance_unverified 不足 2');
  }
  if (el.lists.A.indexOf('7rIovIsXE6kMn629b7kDig') < 0) {
    throw new Error('對照組非 A 類');
  }

  return {
    seed: G3_E1_PILOT_SEED,
    track_count: 5,
    tracks: tracks,
    cohort_coverage_zh: '2×unverified + composer-only + originally unknown + A 對照',
  };
}
