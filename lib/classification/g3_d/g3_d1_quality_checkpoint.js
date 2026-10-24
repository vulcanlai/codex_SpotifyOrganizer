/**
 * G3-D.1 每 10 批品質檢查
 */
import fs from 'node:fs';
import path from 'node:path';
import { SUBGENRES_BY_CODE } from '../genre_taxonomy.js';
import { auto_review_ai_draft_row } from '../g3_b/auto_review.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import crypto from 'node:crypto';
import { G3_D1_BATCH_DRAFTS_DIR, G3_D1_QC_DIR } from './paths_d1.js';
import { write_json_atomic } from '../../atomic_json.js';

function load_imported_rows_through_batch(batch_index_max) {
  /** @type {object[]} */
  const rows = [];
  if (!fs.existsSync(G3_D1_BATCH_DRAFTS_DIR)) {
    return rows;
  }
  const files = fs.readdirSync(G3_D1_BATCH_DRAFTS_DIR).filter(function (f) {
    return f.endsWith('-imported.json');
  });
  files.sort();
  for (let i = 0; i < files.length; i += 1) {
    const m = files[i].match(/^g3d1-batch-(\d+)-imported\.json$/);
    if (!m) {
      continue;
    }
    const idx = parseInt(m[1], 10);
    if (idx > batch_index_max) {
      continue;
    }
    const doc = JSON.parse(fs.readFileSync(path.join(G3_D1_BATCH_DRAFTS_DIR, files[i]), 'utf8'));
    if (doc.tracks) {
      rows.push.apply(rows, doc.tracks);
    }
  }
  return rows;
}

function stable_pick(seed, rows, n) {
  const sorted = rows.slice().sort(function (a, b) {
    const ha = crypto.createHash('sha256').update(seed + a.track_id).digest('hex');
    const hb = crypto.createHash('sha256').update(seed + b.track_id).digest('hex');
    return ha < hb ? -1 : 1;
  });
  return sorted.slice(0, n);
}

/**
 * @param {number} through_batch_index 1-based
 * @param {{ write?: boolean }} [opts]
 */
export function run_g3_d1_quality_checkpoint(through_batch_index, opts) {
  const options = opts || {};
  const write = options.write !== false;
  const rows = load_imported_rows_through_batch(through_batch_index);
  const ev = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8')).tracks || {};

  let import_ok = 0;
  let subgenre_mismatch = 0;
  let low_tier = 0;
  let lang_unconfirmed = 0;
  let instrumental = 0;
  let needs_evidence = 0;
  let conflict = 0;
  const primary_dist = {};
  const lang_dist = {};
  const tier_dist = {};

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    import_ok += 1;
    const pg = row.genre_profile || {};
    const pk = pg.primary_genre || 'unknown';
    primary_dist[pk] = (primary_dist[pk] || 0) + 1;
    const tier = row.confidence_tier || 'unknown';
    tier_dist[tier] = (tier_dist[tier] || 0) + 1;
    if (tier === 'low') {
      low_tier += 1;
    }
    const lang = row.language && row.language.value ? row.language.value : '未確認';
    lang_dist[lang] = (lang_dist[lang] || 0) + 1;
    if (lang === '未確認') {
      lang_unconfirmed += 1;
    }
    for (let s = 0; s < (pg.subgenres || []).length; s += 1) {
      const sub = pg.subgenres[s];
      const meta = SUBGENRES_BY_CODE[sub];
      if (meta && meta.main !== pk) {
        subgenre_mismatch += 1;
        break;
      }
    }
    const specs = row.special_types || [];
    for (let t = 0; t < specs.length; t += 1) {
      if ((specs[t].value || specs[t]) === '純音樂') {
        instrumental += 1;
        break;
      }
    }
    const evt = ev[row.track_id];
    const rule = evt ? rule_classify_track(evt) : {};
    const review = auto_review_ai_draft_row(evt || {}, rule, row);
    if (review.status === 'needs_evidence') {
      needs_evidence += 1;
    }
    if (review.status === 'conflict') {
      conflict += 1;
    }
  }

  const max_primary_share =
    import_ok > 0
      ? Math.max.apply(
          null,
          Object.keys(primary_dist).map(function (k) {
            return primary_dist[k];
          })
        ) / import_ok
      : 0;

  const systemic = [];
  if (subgenre_mismatch > 0) {
    systemic.push('主／子曲風不相容 ' + subgenre_mismatch + ' 首');
  }
  if (max_primary_share > 0.45 && import_ok >= 20) {
    systemic.push('主曲風過度集中 max_share=' + max_primary_share.toFixed(2));
  }

  const spot = stable_pick('g3-d1-qc:' + through_batch_index, rows, 5);

  const report = {
    schema_version: 1,
    through_batch_index: through_batch_index,
    generated_at: new Date().toISOString(),
    imported_count: import_ok,
    metrics: {
      subgenre_mismatch_count: subgenre_mismatch,
      low_confidence_tier_count: low_tier,
      language_unconfirmed_count: lang_unconfirmed,
      instrumental_tagged_count: instrumental,
      needs_evidence_count: needs_evidence,
      conflict_count: conflict,
      primary_genre_distribution: primary_dist,
      language_distribution: lang_dist,
      confidence_tier_distribution: tier_dist,
      max_primary_genre_share: max_primary_share,
    },
    systemic_issues: systemic,
    stop_recommended: systemic.length > 0 && subgenre_mismatch >= 3,
    spot_check_tracks: spot.map(function (r) {
      return {
        track_id: r.track_id,
        title: r.title,
        primary_genre: r.genre_profile && r.genre_profile.primary_genre,
        confidence_tier: r.confidence_tier,
        reason_zh: r.reason_zh,
      };
    }),
    note_zh: 'AI confidence tier ≠ 準確率；spot-check 為代表性複核非準確率估計',
  };

  if (write) {
    fs.mkdirSync(G3_D1_QC_DIR, { recursive: true });
    write_json_atomic(
      path.join(G3_D1_QC_DIR, 'checkpoint-through-batch-' + String(through_batch_index).padStart(2, '0') + '.json'),
      report
    );
  }

  return report;
}
