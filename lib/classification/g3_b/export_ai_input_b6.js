/**
 * G3-B.6 批次 AI 輸入（含主曲風→子曲風合法對照）
 */
import fs from 'node:fs';
import { MAIN_GENRES, subgenres_for_main } from '../genre_taxonomy.js';
import { LANGUAGE_VALUES } from '../dimensions.js';
import {
  compact_evidence_for_ai,
  build_g3b_ai_input_json,
} from './export_ai_input.js';
import { rule_classify_track } from './rule_classify.js';
import { resolve_classification_queue_state } from './queue_state.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';

function main_subgenre_map() {
  const out = {};
  for (let i = 0; i < MAIN_GENRES.length; i += 1) {
    const code = MAIN_GENRES[i].code;
    out[code] = subgenres_for_main(code).map(function (r) {
      return r.code;
    });
  }
  return out;
}

/**
 * @param {string[]} track_ids
 * @param {object} meta
 */
export function build_track_payloads_for_ids(track_ids) {
  const ev_doc = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8'));
  const tracks = ev_doc.tracks || {};
  /** @type {object[]} */
  const payloads = [];
  for (let i = 0; i < track_ids.length; i += 1) {
    const id = track_ids[i];
    const ev = tracks[id];
    if (!ev) {
      throw new Error('evidence 缺少：' + id);
    }
    const rule = rule_classify_track(ev);
    const queue = resolve_classification_queue_state(ev, rule, {});
    payloads.push({
      track_id: id,
      identity: ev.identity,
      human_confirmation: ev.human_confirmation,
      rule_draft: rule,
      queue_state: queue.queue_state,
      ai_pending: queue.needs_ai_generation,
      evidence_compact: compact_evidence_for_ai(ev, rule),
      classification_candidates: (ev.classification_candidates || []).slice(0, 2),
    });
  }
  return payloads;
}

/**
 * @param {string[]} track_ids
 * @param {object} meta
 */
export function build_g3b6_batch_input_md(track_ids, meta) {
  const payloads = build_track_payloads_for_ids(track_ids);
  const sub_map = main_subgenre_map();
  let md = '# G3-B.6 批次 AI 分類輸入\n\n';
  md += '## 主曲風 → 合法子曲風（必遵守 parent）\n\n';
  md += '- `folk_rock` → primary 必須 **folk**（可 secondary `rock`）\n';
  md += '- `pop_rock` → primary 必須 **rock**（可 secondary `pop`）\n\n';
  md += '```json\n' + JSON.stringify(sub_map, null, 2) + '\n```\n\n';
  md += '## 語言\n\n';
  md += LANGUAGE_VALUES.join('、') + '\n\n';
  md += '## 批次 ' + meta.batch_id + '\n\n';
  for (let t = 0; t < payloads.length; t += 1) {
    const p = payloads[t];
    md += '### ' + p.identity.title + ' (`' + p.track_id + '`)\n\n';
    md += JSON.stringify(p, null, 2) + '\n\n';
  }
  return { md: md, payloads: payloads, sub_map: sub_map };
}

export function build_g3b6_draft_template(batch_id, track_ids) {
  const payloads = build_track_payloads_for_ids(track_ids);
  return {
    schema_version: 1,
    source: 'cursor_agent_g3_b6',
    batch_id: batch_id,
    model_note: 'G3-B.6 ' + batch_id + '；G3-A evidence-index；未呼叫外部 API',
    main_to_allowed_subgenres: main_subgenre_map(),
    tracks: payloads.map(function (p) {
      return {
        track_id: p.track_id,
        title: p.identity.title,
        confidence: 'inferred',
        confidence_tier: 'medium',
        genre_profile: {
          primary_genre: 'unknown',
          secondary_genres: [],
          subgenres: [],
          confidence: 'inferred',
        },
        language: {
          value: '未確認',
          confidence: 'unknown',
          vocal_verification_status: 'unverified',
          method: 'g3_b6_cursor_ai',
          evidence: '待填：不得僅憑歌名腳本',
        },
        contexts: [],
        special_types: [],
        version_uncertainty: false,
        reason_zh: '待填',
        evidence_used: [],
        unverified_fields: ['primary_genre', 'vocal_language'],
        human_locked: false,
      };
    }),
  };
}
