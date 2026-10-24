/**
 * Phase 1A：寫入 manifest／CSV／統計（僅試驗目錄）
 */
import fs from 'node:fs';
import path from 'node:path';
import { write_json_atomic } from '../../atomic_json.js';
import {
  EMOTION_TRIAL_1A_DIR,
  EMOTION_TRIAL_1A_TOTAL,
} from './emotion_trial_paths.js';
import {
  select_emotion_trial_1a_sample,
  build_emotion_trial_1a_inventory,
  EMOTION_READINESS_INSUFFICIENT,
} from './emotion_trial_sample.js';

export const EMOTION_TRIAL_1A_MANIFEST_SCHEMA_VERSION = 1;

function csv_escape(s) {
  const t = s == null ? '' : String(s);
  if (/[",\r\n]/.test(t)) {
    return '"' + t.replace(/"/g, '""') + '"';
  }
  return t;
}

/**
 * @param {object[]} rows
 */
export function inventory_rows_to_csv(rows) {
  const header = [
    'track_id',
    'stratum',
    'title',
    'artists',
    'album_name',
    'genre_primary_ref',
    'genre_ref_source',
    'metadata_status',
    'enrichment_cache_complete',
    'has_direct_audio_evidence',
    'has_reliable_lyric_evidence',
    'weak_clues_only',
    'meets_minimum_emotion_evidence',
    'emotion_readiness',
    'evidence_note_zh',
  ];
  const lines = [header.join(',')];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const line = [
      csv_escape(r.track_id),
      csv_escape(r.stratum),
      csv_escape(r.title),
      csv_escape((r.artists || []).join(' | ')),
      csv_escape(r.album_name),
      csv_escape(r.genre_reference && r.genre_reference.primary_genre),
      csv_escape(r.genre_reference && r.genre_reference.source),
      csv_escape(r.metadata_status),
      csv_escape(r.enrichment_cache_complete ? 'true' : 'false'),
      csv_escape(r.has_direct_audio_evidence ? 'true' : 'false'),
      csv_escape(r.has_reliable_lyric_evidence ? 'true' : 'false'),
      csv_escape(r.weak_clues_only ? 'true' : 'false'),
      csv_escape(r.meets_minimum_emotion_evidence ? 'true' : 'false'),
      csv_escape(r.emotion_readiness),
      csv_escape(r.evidence_note_zh),
    ];
    lines.push(line.join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * @param {object[]} rows
 */
export function summarize_inventory(rows) {
  const by_stratum = {};
  let direct_audio = 0;
  let reliable_lyrics = 0;
  let insufficient = 0;
  let eligible = 0;
  let weak_only = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    by_stratum[r.stratum] = (by_stratum[r.stratum] || 0) + 1;
    if (r.has_direct_audio_evidence) {
      direct_audio += 1;
    }
    if (r.has_reliable_lyric_evidence) {
      reliable_lyrics += 1;
    }
    if (r.weak_clues_only) {
      weak_only += 1;
    }
    if (r.emotion_readiness === EMOTION_READINESS_INSUFFICIENT) {
      insufficient += 1;
    } else {
      eligible += 1;
    }
  }

  return {
    track_count: rows.length,
    by_stratum: by_stratum,
    has_direct_audio_evidence_count: direct_audio,
    has_reliable_lyric_evidence_count: reliable_lyrics,
    weak_clues_only_count: weak_only,
    evidence_insufficient_count: insufficient,
    eligible_for_emotion_inference_count: eligible,
    phase0_note_zh:
      '直接音訊＝audio_features 或 direct_audio_verified；可靠歌詞＝evidence-index 內 is_direct_fact 之歌詞欄位。目前 Track API 快取不含 Audio Features。',
  };
}

/**
 * @param {object} summary
 * @param {object} selection
 */
export function build_report_md(summary, selection) {
  let md = '# G3 情緒試驗 Phase 1A 證據盤點\n\n';
  md += '- seed：`' + selection.seed + '`\n';
  md += '- 全庫曲目：' + selection.library_track_count + '\n';
  md += '- 抽樣：' + EMOTION_TRIAL_1A_TOTAL + ' 首（30 High 曲風／30 complete／20 missing）\n\n';
  md += '## 分層\n\n';
  const bs = summary.by_stratum || {};
  const keys = Object.keys(bs).sort();
  for (let i = 0; i < keys.length; i += 1) {
    md += '- `' + keys[i] + '`：' + bs[keys[i]] + '\n';
  }
  md += '\n## 證據（可支援情緒推論）\n\n';
  md += '- 直接音訊證據：' + summary.has_direct_audio_evidence_count + '\n';
  md += '- 可靠歌詞證據：' + summary.has_reliable_lyric_evidence_count + '\n';
  md += '- 證據不足（evidence_insufficient）：' + summary.evidence_insufficient_count + '\n';
  md += '- 僅弱線索：' + summary.weak_clues_only_count + '\n\n';
  md += summary.phase0_note_zh + '\n';
  return md;
}

/**
 * @param {object} [opts]
 */
export function run_emotion_trial_1a_export(opts) {
  const options = opts || {};
  const write = options.write !== false;
  const out_dir = options.out_dir || EMOTION_TRIAL_1A_DIR;

  const selection = select_emotion_trial_1a_sample(options);
  const rows = build_emotion_trial_1a_inventory(selection, options);
  const summary = summarize_inventory(rows);

  const manifest = {
    schema_version: EMOTION_TRIAL_1A_MANIFEST_SCHEMA_VERSION,
    purpose: 'g3_emotion_trial_1a_evidence_inventory',
    generated_at: new Date().toISOString(),
    seed: selection.seed,
    library_track_count: selection.library_track_count,
    g3_f_high_adopted_count: selection.g3_f_high_adopted_count,
    pool_sizes: selection.pool_sizes,
    stratum_counts: EMOTION_TRIAL_1A_TOTAL
      ? {
          g3_f_high_genre: selection.strata.g3_f_high_genre.length,
          metadata_complete_not_high: selection.strata.metadata_complete_not_high.length,
          metadata_missing: selection.strata.metadata_missing.length,
        }
      : {},
    track_ids: selection.track_ids,
    strata: selection.strata,
    summary: summary,
    outputs: {
      csv: 'trial-sample-80.csv',
      summary: 'inventory-summary.json',
      report: 'inventory-report-zh.md',
    },
  };

  if (!write) {
    return { manifest: manifest, rows: rows, summary: summary, selection: selection };
  }

  fs.mkdirSync(out_dir, { recursive: true });
  write_json_atomic(path.join(out_dir, 'trial-manifest.json'), manifest);
  write_json_atomic(path.join(out_dir, 'inventory-summary.json'), {
    schema_version: 1,
    ...summary,
    seed: selection.seed,
    generated_at: manifest.generated_at,
  });
  fs.writeFileSync(
    path.join(out_dir, 'trial-sample-80.csv'),
    inventory_rows_to_csv(rows),
    'utf8'
  );
  fs.writeFileSync(
    path.join(out_dir, 'inventory-report-zh.md'),
    build_report_md(summary, selection),
    'utf8'
  );

  return {
    manifest: manifest,
    rows: rows,
    summary: summary,
    selection: selection,
    out_dir: out_dir,
  };
}
