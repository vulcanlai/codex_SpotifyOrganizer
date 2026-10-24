/**
 * G3-B.4 30 首合併品質報告（重用 + 新批次）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import { auto_review_ai_draft_batch } from './auto_review.js';
import { FILE_G3_B1_AI_DRAFT_READONLY } from './paths_b2.js';
import {
  FILE_G3_B3_REUSE_REGISTRY,
  FILE_G3_B3_FIELD_TASKS,
  G3_B3_BATCH_DRAFTS_DIR,
} from './paths_b3.js';
import { FILE_G3_B4_MERGED_QUALITY } from './paths_b4.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { rule_classify_track } from './rule_classify.js';
import { ensure_g3_b_sample } from './sample.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function load_all_b4_imported_tracks() {
  /** @type {object[]} */
  const rows = [];
  if (!fs.existsSync(G3_B3_BATCH_DRAFTS_DIR)) {
    return rows;
  }
  const files = fs.readdirSync(G3_B3_BATCH_DRAFTS_DIR).filter(function (f) {
    return f.endsWith('-imported.json');
  });
  files.sort();
  for (let i = 0; i < files.length; i += 1) {
    const doc = read_json(G3_B3_BATCH_DRAFTS_DIR + '/' + files[i]);
    if (doc && doc.tracks) {
      rows.push.apply(rows, doc.tracks);
    }
  }
  return rows;
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function build_g3_b4_merged_quality_report(opts) {
  const options = opts || {};
  const sample = ensure_g3_b_sample({ write: false });
  const ev_index = read_json(file_g3_evidence_index());
  const reuse = read_json(FILE_G3_B3_REUSE_REGISTRY);
  const g3b1 = read_json(FILE_G3_B1_AI_DRAFT_READONLY);
  const b4_rows = load_all_b4_imported_tracks();
  const field_tasks = read_json(FILE_G3_B3_FIELD_TASKS);

  const g3b1_by_id = {};
  if (g3b1 && g3b1.tracks) {
    for (let i = 0; i < g3b1.tracks.length; i += 1) {
      g3b1_by_id[g3b1.tracks[i].track_id] = g3b1.tracks[i];
    }
  }

  const b4_by_id = {};
  for (let j = 0; j < b4_rows.length; j += 1) {
    b4_by_id[b4_rows[j].track_id] = b4_rows[j];
  }

  const tier_counts = { high: 0, medium: 0, low: 0, unset: 0 };
  const primary_counts = {};
  let unknown_primary = 0;
  let language_unknown = 0;
  let version_uncertain = 0;
  let ai_processed = 0;
  let reused_count = 0;
  let newly_generated = b4_rows.length;

  const per_track = [];

  for (let s = 0; s < sample.track_ids.length; s += 1) {
    const id = sample.track_ids[s];
    const ev = ev_index.tracks[id];
    const row = b4_by_id[id] || g3b1_by_id[id] || null;
    const reuse_row = reuse && reuse.tracks ? reuse.tracks.find(function (t) {
      return t.track_id === id;
    }) : null;

    if (row) {
      ai_processed += 1;
    }
    if (b4_by_id[id]) {
      /* new */
    } else if (g3b1_by_id[id] && reuse_row && reuse_row.reusable) {
      reused_count += 1;
    }

    const gp = row && row.genre_profile ? row.genre_profile : { primary_genre: 'unknown' };
    const primary = gp.primary_genre || GENRE_PRIMARY_UNKNOWN;
    primary_counts[primary] = (primary_counts[primary] || 0) + 1;
    if (primary === GENRE_PRIMARY_UNKNOWN) {
      unknown_primary += 1;
    }

    const lang = row && row.language ? row.language.value : '未確認';
    if (lang === '未確認') {
      language_unknown += 1;
    }

    const tier = row && row.confidence_tier ? row.confidence_tier : 'unset';
    if (tier_counts[tier] != null) {
      tier_counts[tier] += 1;
    } else {
      tier_counts.unset += 1;
    }

    if (row && row.version_uncertainty === true) {
      version_uncertain += 1;
    }

    per_track.push({
      track_id: id,
      title: ev ? ev.identity.title : null,
      source: b4_by_id[id] ? 'g3_b4_batch' : g3b1_by_id[id] ? 'g3_b1_reuse' : 'none',
      primary_genre: primary,
      language: lang,
    });
  }

  const rule_by_id = {};
  const evidence_by_id = ev_index.tracks;
  for (let r = 0; r < b4_rows.length; r += 1) {
    const id = b4_rows[r].track_id;
    rule_by_id[id] = rule_classify_track(evidence_by_id[id]);
  }

  const auto_b4 = auto_review_ai_draft_batch(b4_rows, evidence_by_id, rule_by_id);
  const auto_g3b1 = g3b1 && g3b1.tracks
    ? auto_review_ai_draft_batch(
        g3b1.tracks,
        evidence_by_id,
        sample.track_ids.reduce(function (acc, id) {
          acc[id] = rule_classify_track(evidence_by_id[id]);
          return acc;
        }, {})
      )
    : { counts: {} };

  let rule_conflicts = 0;
  for (let b = 0; b < b4_rows.length; b += 1) {
    const tr = b4_rows[b];
    const rule = rule_by_id[tr.track_id];
    if (
      rule &&
      rule.genre_profile.primary_genre !== GENRE_PRIMARY_UNKNOWN &&
      tr.genre_profile &&
      tr.genre_profile.primary_genre !== rule.genre_profile.primary_genre
    ) {
      rule_conflicts += 1;
    }
  }

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    disclaimer_zh: '統計含 AI 自評信心，非人工聽音準確率；人工 confirmed 未自動套用。',
    counts: {
      sample_total: 30,
      ai_processed_total: ai_processed,
      newly_generated_g3_b4: newly_generated,
      reused_g3_b1: reused_count,
      unknown_primary_genre: unknown_primary,
      unknown_vocal_language: language_unknown,
      confidence_tier: tier_counts,
      primary_genre_distribution: primary_counts,
      rule_draft_conflicts_g3_b4: rule_conflicts,
      version_uncertainty_marked: version_uncertain,
      auto_review_g3_b4: auto_b4.counts,
      auto_review_g3_b1_unchanged: auto_g3b1.counts,
      field_evidence_tasks_open: field_tasks ? field_tasks.tasks.length : 0,
      needs_human_decision:
        (auto_g3b1.counts.needs_human_decision || 0),
    },
    per_track: per_track,
  };

  if (options.write !== false) {
    write_json_atomic(FILE_G3_B4_MERGED_QUALITY, report);
  }
  return report;
}
