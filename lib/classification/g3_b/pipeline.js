/**
 * G3-B 試驗管線（離線、可續跑）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { build_g3_evidence_index } from '../g3_evidence/build_evidence_index.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { ensure_g3_b_sample } from './sample.js';
import { rule_classify_track, validate_genre_profile_draft } from './rule_classify.js';
import {
  build_g3b_ai_input_json,
  build_g3b_ai_input_md,
  compact_evidence_for_ai,
} from './export_ai_input.js';
import {
  G3_B_TRIAL_DIR,
  FILE_G3_B_RULE_DRAFT,
  FILE_G3_B_AI_INPUT_JSON,
  FILE_G3_B_AI_INPUT_MD,
  FILE_G3_B_AI_PENDING,
  FILE_G3_B_QUALITY_REPORT,
  FILE_G3_B_PROGRESS,
  G3_B_SCHEMA_VERSION,
} from './paths.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function load_evidence_index() {
  let path = file_g3_evidence_index();
  if (!fs.existsSync(path)) {
    build_g3_evidence_index({ write: true });
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

/**
 * @param {{ write?: boolean, resume?: boolean }} [opts]
 */
export function run_g3_b_trial_pipeline(opts) {
  const options = opts || {};
  const write = options.write !== false;

  if (!fs.existsSync(G3_B_TRIAL_DIR)) {
    fs.mkdirSync(G3_B_TRIAL_DIR, { recursive: true });
  }

  const sample = ensure_g3_b_sample({ write: write });
  const evidence_index = load_evidence_index();
  const progress = read_json(FILE_G3_B_PROGRESS) || {
    schema_version: G3_B_SCHEMA_VERSION,
    sample_id: sample.sample_id,
    completed_ids: [],
    updated_at: null,
  };

  const ids = sample.track_ids.slice();
  /** @type {object[]} */
  const rule_rows = [];
  /** @type {object[]} */
  const ai_payloads = [];
  /** @type {object[]} */
  const ai_pending = [];

  const kind_counts = {
    human_locked: 0,
    evidence_direct: 0,
    inference: 0,
    unknown: 0,
  };

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const ev = evidence_index.tracks[id];
    if (!ev) {
      continue;
    }
    const draft = rule_classify_track(ev);
    if (!validate_genre_profile_draft(draft.genre_profile)) {
      throw new Error('非法主曲風：' + id);
    }
    rule_rows.push(draft);
    if (kind_counts[draft.classification_kind] != null) {
      kind_counts[draft.classification_kind] += 1;
    }

    const payload = {
      track_id: id,
      identity: {
        title: ev.identity.title,
        artists: ev.identity.artists,
        album_name: ev.identity.album_name,
        isrc: ev.identity.isrc,
      },
      human_confirmation: ev.human_confirmation || { locked: false },
      rule_draft: {
        classification_kind: draft.classification_kind,
        genre_profile: draft.genre_profile,
        language: draft.language,
        confidence_tier: draft.confidence_tier,
        uncertainty: draft.uncertainty,
      },
      ai_pending: draft.ai_pending,
      queue_state: draft.queue_state,
      evidence_compact: compact_evidence_for_ai(ev, draft),
    };
    ai_payloads.push(payload);
    if (draft.needs_ai_generation) {
      ai_pending.push({
        track_id: id,
        title: ev.identity.title,
        queue_state: draft.queue_state,
        reason: draft.queue_reason_zh || draft.uncertainty.join('；') || '待 AI 補強',
      });
    }
    if (progress.completed_ids.indexOf(id) === -1) {
      progress.completed_ids.push(id);
    }
  }

  const now = new Date().toISOString();
  progress.updated_at = now;

  const rule_doc = {
    schema_version: G3_B_SCHEMA_VERSION,
    sample_id: sample.sample_id,
    generated_at: now,
    engine: 'g3_b_rules_offline',
    note: '規則草稿；非 AI 輸出；不寫入 formal/manual-overrides',
    tracks: rule_rows,
  };

  const ai_json = build_g3b_ai_input_json(ai_payloads, {
    sample_id: sample.sample_id,
    exported_at: now,
  });
  const ai_md = build_g3b_ai_input_md(ai_payloads, {
    sample_id: sample.sample_id,
    exported_at: now,
  });

  const quality = {
    schema_version: G3_B_SCHEMA_VERSION,
    generated_at: now,
    sample_id: sample.sample_id,
    track_count: rule_rows.length,
    classification_kind_counts: kind_counts,
    ai_pending_count: ai_pending.length,
    human_locked_count: kind_counts.human_locked,
    with_mb_sample: ids.filter(function (id) {
      return (
        evidence_index.tracks[id] &&
        evidence_index.tracks[id].verification_status.in_musicbrainz_sample
      );
    }).length,
    validation: {
      all_genre_profiles_valid: true,
    },
    summary_zh: [
      '規則引擎離線完成 ' + rule_rows.length + ' 首',
      '待 Cursor AI 分類 ' + ai_pending.length + ' 首',
      '人工鎖定 ' + kind_counts.human_locked + ' 首（試驗樣本內）',
    ],
  };

  if (write) {
    write_json_atomic(FILE_G3_B_RULE_DRAFT, rule_doc);
    write_json_atomic(FILE_G3_B_AI_INPUT_JSON, ai_json);
    fs.writeFileSync(FILE_G3_B_AI_INPUT_MD, ai_md, 'utf8');
    write_json_atomic(FILE_G3_B_AI_PENDING, {
      schema_version: G3_B_SCHEMA_VERSION,
      generated_at: now,
      pending: ai_pending,
    });
    write_json_atomic(FILE_G3_B_QUALITY_REPORT, quality);
    write_json_atomic(FILE_G3_B_PROGRESS, progress);
  }

  return {
    sample: sample,
    rule_doc: rule_doc,
    ai_json: ai_json,
    quality: quality,
    ai_pending: ai_pending,
  };
}
