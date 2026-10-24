/**
 * G3-B.1 AI 試驗品質報告（AI 自評信心 ≠ 人工驗證準確率）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import {
  FILE_G3_B_RULE_DRAFT,
  FILE_G3_B_AI_DRAFT_IMPORTED,
  FILE_G3_B_AI_PENDING,
  G3_B_TRIAL_DIR,
} from './paths.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function primary_from_v2_candidate(ev_doc) {
  const list = ev_doc.classification_candidates || [];
  if (!list.length) {
    return null;
  }
  const c = list[0].candidate || list[0];
  if (!c) {
    return null;
  }
  const gp = c.genre_profile || c.primary_genre;
  if (typeof gp === 'string') {
    return gp;
  }
  if (gp && gp.primary_genre) {
    return typeof gp.primary_genre === 'object' ? gp.primary_genre.value : gp.primary_genre;
  }
  if (c.primary_genre && typeof c.primary_genre === 'object') {
    return c.primary_genre.value;
  }
  return null;
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function build_g3_b_ai_trial_quality_report(opts) {
  const options = opts || {};
  const pending = read_json(FILE_G3_B_AI_PENDING);
  const ai_doc = read_json(FILE_G3_B_AI_DRAFT_IMPORTED);
  const rule_doc = read_json(FILE_G3_B_RULE_DRAFT);
  const ev_index = read_json(file_g3_evidence_index());

  const pending_ids = (pending.pending || []).map(function (p) {
    return p.track_id;
  });

  if (!ai_doc || !ai_doc.tracks) {
    throw new Error('尚未匯入 ai-classification-draft.json');
  }

  const tier_counts = { high: 0, medium: 0, low: 0, unset: 0 };
  const primary_counts = {};
  let unknown_primary = 0;
  let language_unknown = 0;
  let conflicts_rule = 0;
  let conflicts_v2 = 0;
  let needs_human = 0;

  const per_track = [];

  for (let i = 0; i < ai_doc.tracks.length; i += 1) {
    const row = ai_doc.tracks[i];
    const ev = ev_index.tracks[row.track_id];
    const rule = (rule_doc.tracks || []).find(function (r) {
      return r.track_id === row.track_id;
    });
    const gp = row.genre_profile || {};
    const primary = gp.primary_genre || GENRE_PRIMARY_UNKNOWN;
    primary_counts[primary] = (primary_counts[primary] || 0) + 1;
    if (primary === GENRE_PRIMARY_UNKNOWN) {
      unknown_primary += 1;
    }

    const lang = row.language && row.language.value ? row.language.value : '未確認';
    if (lang === '未確認') {
      language_unknown += 1;
    }

    const tier = row.confidence_tier || 'unset';
    if (tier_counts[tier] != null) {
      tier_counts[tier] += 1;
    } else {
      tier_counts.unset += 1;
    }

    let conflict_rule = false;
    if (
      rule &&
      rule.genre_profile &&
      rule.genre_profile.primary_genre !== GENRE_PRIMARY_UNKNOWN &&
      rule.genre_profile.primary_genre !== primary
    ) {
      conflict_rule = true;
      conflicts_rule += 1;
    }

    const v2_primary = ev ? primary_from_v2_candidate(ev) : null;
    let conflict_v2 = false;
    if (v2_primary && v2_primary !== primary && primary !== GENRE_PRIMARY_UNKNOWN) {
      conflict_v2 = true;
      conflicts_v2 += 1;
    }

    const human_review =
      row.confidence_tier === 'low' ||
      primary === GENRE_PRIMARY_UNKNOWN ||
      (row.version_uncertainty === true) ||
      conflict_rule ||
      (ev &&
        ev.verification_status &&
        ev.verification_status.g2 &&
        ev.verification_status.g2.pending_verification);

    if (human_review) {
      needs_human += 1;
    }

    per_track.push({
      track_id: row.track_id,
      title: row.title || (ev && ev.identity ? ev.identity.title : null),
      primary_genre: primary,
      language: lang,
      confidence_tier: tier,
      conflict_with_rule_draft: conflict_rule,
      conflict_with_v2_candidate: conflict_v2,
      flagged_for_human_review: human_review,
    });
  }

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    disclaimer_zh:
      '本報告統計為 AI 草稿自評（confidence_tier／inferred），不代表已人工聽音或驗證準確率。',
    counts: {
      ai_pending_list: pending_ids.length,
      ai_draft_tracks: ai_doc.tracks.length,
      ai_with_known_primary: ai_doc.tracks.length - unknown_primary,
      ai_primary_unknown: unknown_primary,
      language_unknown: language_unknown,
      confidence_tier: tier_counts,
      primary_genre_distribution: primary_counts,
      conflicts_with_rule_draft: conflicts_rule,
      conflicts_with_v2_ai_candidate: conflicts_v2,
      flagged_needs_human_review: needs_human,
    },
    per_track: per_track,
  };

  const out_path = G3_B_TRIAL_DIR + '/ai-trial-quality-report.json';
  if (options.write !== false) {
    write_json_atomic(out_path, report);
  }
  return report;
}
