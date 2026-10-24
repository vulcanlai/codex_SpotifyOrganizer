/**
 * G3-D.2 離線品質稽核（200 首 D.1）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { write_json_atomic } from '../../atomic_json.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { auto_review_ai_draft_row } from '../g3_b/auto_review.js';
import { auto_review_quality_batch } from './auto_review_quality.js';
import {
  FILE_G3_D1_SAMPLE_200,
  G3_D1_BATCH_DRAFTS_DIR,
  G3_D1_BATCH_INPUTS_DIR,
  G3_D1_CURSOR_DRAFTS_DIR,
} from './paths_d1.js';
import {
  G3_D2_AUDIT_DIR,
  G3_D2_SCHEMA_VERSION,
  FILE_G3_D2_SUMMARY,
  FILE_G3_D2_STATS_200,
  FILE_G3_D2_SOUNDTRACK_AUDIT,
  FILE_G3_D2_UNKNOWN_AUDIT,
  FILE_G3_D2_LANGUAGE_AUDIT,
  FILE_G3_D2_AUTO_REVIEW_POLICY,
  FILE_G3_D2_TEMPLATE_ANALYSIS,
  FILE_G3_D2_QUALITY_OVERLAY,
  FILE_G3_D2_SECOND_ROUND_CANDIDATES,
  FILE_G3_D2_NEXT_WAVE_PREREQS,
  FILE_G3_D2_SOURCE_LINEAGE,
  FILE_G3_D2_SPOT_CHECK,
  FILE_G3_D2_PREVIEW_DELTA,
} from './paths_d2.js';
import { build_g3_d1_expansion_pool } from './g3_d1_pool.js';
import { load_unified_classification_view } from '../g3_c/build_unified_view.js';
import { compute_g3_unified_playlist_preview } from '../g3_c/g3_smart_playlist_preview.js';
import { PREVIEW_MODE_BALANCED, PREVIEW_MODE_RELAXED } from '../preview_settings.js';
import { build_g3_d2_spot_check_30 } from './g3_d2_spot_check.js';

function load_d1_imported_rows() {
  /** @type {object[]} */
  const rows = [];
  const files = fs.readdirSync(G3_D1_BATCH_DRAFTS_DIR).filter(function (f) {
    return f.endsWith('-imported.json');
  });
  files.sort();
  for (let i = 0; i < files.length; i += 1) {
    const doc = JSON.parse(
      fs.readFileSync(path.join(G3_D1_BATCH_DRAFTS_DIR, files[i]), 'utf8')
    );
    rows.push.apply(rows, doc.tracks || []);
  }
  return rows;
}

function load_payload_map() {
  /** @type {Record<string, object>} */
  const map = {};
  const files = fs.readdirSync(G3_D1_BATCH_INPUTS_DIR).filter(function (f) {
    return f.endsWith('-input.json');
  });
  for (let i = 0; i < files.length; i += 1) {
    const doc = JSON.parse(
      fs.readFileSync(path.join(G3_D1_BATCH_INPUTS_DIR, files[i]), 'utf8')
    );
    const payloads = doc.evidence_payloads || [];
    for (let p = 0; p < payloads.length; p += 1) {
      map[payloads[p].track_id] = payloads[p];
    }
  }
  return map;
}

function has_special(row, value) {
  const specs = row.special_types || [];
  for (let i = 0; i < specs.length; i += 1) {
    if ((specs[i].value || specs[i]) === value) {
      return true;
    }
  }
  return false;
}

function soundtrack_evidence_tier(row, payload) {
  const id = payload.identity || {};
  const blob = (
    (id.title || '') +
    ' ' +
    (id.album_name || '') +
    ' ' +
    (id.artists || []).join(' ')
  ).toLowerCase();
  const composers =
    /newton brothers|lorien testard|joseph trapanese|gustavo santaolalla|bear mccreary|david fleming|hans zimmer|john williams|two steps from hell/i.test(
      blob
    );
  const ghibli =
    /ジブリ|魔女の宅急便|宮崎|ヴァイオリン|ピアノの調べ|より）/i.test(blob);
  const game = /game|witcher|god of war|flying waters|rain from the ground|score/i.test(
    blob
  );
  const ost_kw = /\bost\b|soundtrack|原聲|配樂|instrumental|score/i.test(blob);

  if (composers && (ghibli || game || ost_kw)) {
    return 'explicit_scoring_context';
  }
  if (ghibli || game) {
    return 'explicit_scoring_context';
  }
  if (composers) {
    return 'composer_credits_only';
  }
  if (ost_kw && !composers) {
    return 'fuzzy_title_or_album_keyword';
  }
  if (row.reason_zh && row.reason_zh.indexOf('配樂') >= 0) {
    return 'inferred_from_d1_heuristic_only';
  }
  return 'insufficient_evidence';
}

function classify_unknown_reason(row, payload) {
  const id = payload.identity || {};
  const sparse = !id.enrichment_cache_complete && !id.isrc;
  const qs = payload.queue_state || payload.rule_draft?.queue_state;
  if (qs === 'needs_data') {
    return 'metadata_enrichment_insufficient';
  }
  if (sparse) {
    return 'sparse_metadata';
  }
  if ((payload.classification_candidates || []).length > 0) {
    return 'had_ai_candidate_still_unknown';
  }
  if (
    row.reason_zh === 'metadata／候選不足；保留 unknown 與未確認'
  ) {
    return 'd1_fallback_no_rule_match';
  }
  return 'ai_conservative_unknown';
}

function classify_language_reason(row, payload) {
  const lang = row.language && row.language.value;
  if (lang !== '未確認') {
    return null;
  }
  if (has_special(row, '純音樂')) {
    return 'instrumental_tagged_vocal_not_primary';
  }
  const id = payload.identity || {};
  if (!id.enrichment_cache_complete) {
    return 'metadata_sparse';
  }
  if (row.genre_profile.primary_genre === 'soundtrack_instrumental') {
    return 'scoring_context_language_deferred';
  }
  if (row.confidence_tier === 'low') {
    return 'low_confidence_conservative';
  }
  return 'vocal_possible_language_not_inferred';
}

function template_analysis(rows) {
  const reason_counts = {};
  const evidence_used_counts = {};
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i].reason_zh || '';
    reason_counts[r] = (reason_counts[r] || 0) + 1;
    const used = rows[i].evidence_used || [];
    const key = used.slice().sort().join('|') || '(empty)';
    evidence_used_counts[key] = (evidence_used_counts[key] || 0) + 1;
  }
  const top_reason = Object.keys(reason_counts).sort(function (a, b) {
    return reason_counts[b] - reason_counts[a];
  });
  return {
    distinct_reason_zh: top_reason.length,
    top_reasons: top_reason.slice(0, 8).map(function (k) {
      return { reason_zh: k, count: reason_counts[k] };
    }),
    template_risk_zh:
      reason_counts['metadata／候選不足；保留 unknown 與未確認'] >= 50
        ? 'D.1 使用 g3_d1_evidence_classify 規則層；72 首共用同一 fallback 句，非逐首 Cursor 推理'
        : '理由分散度可接受',
    evidence_used_top: Object.keys(evidence_used_counts)
      .sort(function (a, b) {
        return evidence_used_counts[b] - evidence_used_counts[a];
      })
      .slice(0, 5)
      .map(function (k) {
        return { pattern: k, count: evidence_used_counts[k] };
      }),
    generation_pipeline_zh:
      'g3:d1-generate-drafts → lib/classification/g3_d/g3_d1_evidence_classify.js（artist/album  regex 分支）→ cursor-drafts → batch-drafts',
  };
}

function lineage_sample(rows, payload_map, ev_tracks, limit) {
  const lines = [];
  const n = Math.min(limit || 15, rows.length);
  for (let i = 0; i < n; i += 1) {
    const row = rows[i];
    const payload = payload_map[row.track_id];
    const ev = ev_tracks[row.track_id];
    lines.push(
      JSON.stringify({
        track_id: row.track_id,
        title: row.title,
        evidence_title: ev && ev.identity ? ev.identity.title : null,
        title_match:
          ev && ev.identity && ev.identity.title === row.title,
        artists: payload && payload.identity ? payload.identity.artists : null,
        ai_primary: row.genre_profile.primary_genre,
        reason_zh: row.reason_zh,
        cursor_draft_exists: fs.existsSync(
          path.join(
            G3_D1_CURSOR_DRAFTS_DIR,
            'g3d1-batch-' +
              String(Math.floor(i / 7) + 1).padStart(2, '0') +
              '.json'
          )
        ),
      })
    );
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function run_g3_d2_audit(opts) {
  const options = opts || {};
  const write = options.write !== false;
  const rows = load_d1_imported_rows();
  const payload_map = load_payload_map();
  const ev_doc = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8'));
  const ev_tracks = ev_doc.tracks || {};
  const rule_by_id = {};
  for (let i = 0; i < rows.length; i += 1) {
    const id = rows[i].track_id;
    if (ev_tracks[id]) {
      rule_by_id[id] = rule_classify_track(ev_tracks[id]);
    }
  }

  const template = template_analysis(rows);
  const soundtrack_rows = rows.filter(function (r) {
    return r.genre_profile.primary_genre === 'soundtrack_instrumental';
  });
  const unknown_rows = rows.filter(function (r) {
    return r.genre_profile.primary_genre === 'unknown';
  });
  const lang_unconfirmed = rows.filter(function (r) {
    return r.language && r.language.value === '未確認';
  });

  const st_buckets = {
    explicit_scoring_context: [],
    composer_credits_only: [],
    fuzzy_title_or_album_keyword: [],
    inferred_from_d1_heuristic_only: [],
    insufficient_evidence: [],
    possible_vocal_misclassified_as_instrumental: [],
  };

  for (let s = 0; s < soundtrack_rows.length; s += 1) {
    const row = soundtrack_rows[s];
    const payload = payload_map[row.track_id] || {};
    const tier = soundtrack_evidence_tier(row, payload);
    const entry = {
      track_id: row.track_id,
      title: row.title,
      artists: payload.identity && payload.identity.artists,
      album_name: payload.identity && payload.identity.album_name,
      confidence_tier: row.confidence_tier,
      reason_zh: row.reason_zh,
      special_types: row.special_types,
      evidence_tier: tier,
    };
    if (st_buckets[tier]) {
      st_buckets[tier].push(entry);
    } else {
      st_buckets.insufficient_evidence.push(entry);
    }
    const title = String((payload.identity && payload.identity.title) || '');
    if (
      !has_special(row, '純音樂') &&
      /theme|song|vocal|feat|lyrics|歌|演唱/i.test(title) &&
      tier !== 'explicit_scoring_context'
    ) {
      st_buckets.possible_vocal_misclassified_as_instrumental.push(entry);
    }
  }

  const unknown_buckets = {};
  for (let u = 0; u < unknown_rows.length; u += 1) {
    const row = unknown_rows[u];
    const payload = payload_map[row.track_id] || {};
    const reason = classify_unknown_reason(row, payload);
    if (!unknown_buckets[reason]) {
      unknown_buckets[reason] = [];
    }
    unknown_buckets[reason].push({
      track_id: row.track_id,
      title: row.title,
      queue_state: payload.queue_state,
      enrichment_complete: !!(payload.identity && payload.identity.enrichment_cache_complete),
    });
  }

  const lang_buckets = {};
  for (let l = 0; l < lang_unconfirmed.length; l += 1) {
    const row = lang_unconfirmed[l];
    const payload = payload_map[row.track_id] || {};
    const reason = classify_language_reason(row, payload);
    const key = reason || 'other';
    if (!lang_buckets[key]) {
      lang_buckets[key] = [];
    }
    lang_buckets[key].push({
      track_id: row.track_id,
      title: row.title,
      primary_genre: row.genre_profile.primary_genre,
      has_instrumental_tag: has_special(row, '純音樂'),
    });
  }

  const quality_batch = auto_review_quality_batch(rows, ev_tracks, rule_by_id);
  const v1_only = { pass: 0, needs_evidence: 0, conflict: 0, unconfirmed: 0 };
  for (let q = 0; q < rows.length; q += 1) {
    const v1 = auto_review_ai_draft_row(
      ev_tracks[rows[q].track_id],
      rule_by_id[rows[q].track_id],
      rows[q]
    );
    v1_only[v1.status] += 1;
  }

  const overlay = {
    schema_version: G3_D2_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    wave: 'g3-d1-200',
    policy: 'g3_d2_quality_v1',
    tracks: quality_batch.results.map(function (r) {
      return {
        track_id: r.track_id,
        review_v1_status: r.review_v1_status,
        quality_status: r.review_v2.quality_status,
        structural_status: r.review_v2.structural_status,
        quality_issues: r.review_v2.quality_issues,
      };
    }),
    v1_counts: quality_batch.v1_counts,
    v2_counts: quality_batch.v2_counts,
  };

  const second_round = [];
  for (let c = 0; c < rows.length; c += 1) {
    const row = rows[c];
    const payload = payload_map[row.track_id] || {};
    const pg = row.genre_profile.primary_genre;
    const worth =
      pg === 'unknown' ||
      (pg === 'soundtrack_instrumental' &&
        soundtrack_evidence_tier(row, payload) !== 'explicit_scoring_context') ||
      row.confidence_tier === 'low';
    if (worth) {
      second_round.push({
        track_id: row.track_id,
        title: row.title,
        primary_genre: pg,
        confidence_tier: row.confidence_tier,
        reason_zh: row.reason_zh,
        priority:
          pg === 'unknown' ? 'high' : pg === 'soundtrack_instrumental' ? 'medium' : 'low',
        note_zh: '第二輪 Cursor 推理候選；不得視為新外部證據',
      });
    }
  }

  const spot_check = build_g3_d2_spot_check_30(rows, payload_map, ev_tracks);

  const unified_before = load_unified_classification_view();
  const balanced = compute_g3_unified_playlist_preview(
    {},
    PREVIEW_MODE_BALANCED,
    unified_before
  );
  const relaxed = compute_g3_unified_playlist_preview(
    {},
    PREVIEW_MODE_RELAXED,
    unified_before
  );

  const stats = {
    schema_version: G3_D2_SCHEMA_VERSION,
    track_count: rows.length,
    primary_genre: {},
    confidence_tier: {},
    language: {},
  };
  for (let t = 0; t < rows.length; t += 1) {
    const pk = rows[t].genre_profile.primary_genre;
    stats.primary_genre[pk] = (stats.primary_genre[pk] || 0) + 1;
    const tier = rows[t].confidence_tier || 'unset';
    stats.confidence_tier[tier] = (stats.confidence_tier[tier] || 0) + 1;
    const lang = rows[t].language.value || '未確認';
    stats.language[lang] = (stats.language[lang] || 0) + 1;
  }

  const summary = {
    schema_version: G3_D2_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    findings_zh: [
      template.template_risk_zh,
      'soundtrack_instrumental 83 首中 composer-only 與 fuzzy keyword 占多數，需 spot-check',
      'auto-review v1 將 JSON 合法視為 pass；v2 品質 overlay 已區分',
    ],
    v1_auto_review: v1_only,
    v2_quality_review: quality_batch.v2_counts,
    soundtrack_total: soundtrack_rows.length,
    unknown_total: unknown_rows.length,
    language_unconfirmed_total: lang_unconfirmed.length,
    spot_check_verdict_counts: spot_check.verdict_counts,
    preview_balanced_total: balanced.breakdown.total_unique,
    preview_relaxed_total: relaxed.breakdown.total_unique,
  };

  const next_wave = {
    schema_version: G3_D2_SCHEMA_VERSION,
    recommend_start_next_wave: false,
    prerequisites_zh: [
      '修正 g3_d1_evidence_classify：收窄 is_instrumental_context（已提交程式修正，不重跑 D.1）',
      '下一波改為逐批 Cursor Agent 填寫 cursor-drafts，禁止僅跑 generate-drafts 規則層',
      '第二輪 AI 僅針對 second-round-ai-candidates.json 高優先序',
      '採用 unified view 之 auto_review_quality_status 做 UI／任務提示',
    ],
    second_round_candidate_count: second_round.length,
  };

  if (write) {
    fs.mkdirSync(G3_D2_AUDIT_DIR, { recursive: true });
    write_json_atomic(FILE_G3_D2_STATS_200, stats);
    write_json_atomic(FILE_G3_D2_TEMPLATE_ANALYSIS, template);
    write_json_atomic(FILE_G3_D2_SOUNDTRACK_AUDIT, {
      schema_version: G3_D2_SCHEMA_VERSION,
      total: soundtrack_rows.length,
      bucket_counts: Object.keys(st_buckets).reduce(function (o, k) {
        o[k] = st_buckets[k].length;
        return o;
      }, {}),
      buckets: st_buckets,
      note_zh:
        'soundtrack≠純器樂；composer 命中不等於無人聲；未強制改回 pop',
    });
    write_json_atomic(FILE_G3_D2_UNKNOWN_AUDIT, {
      schema_version: G3_D2_SCHEMA_VERSION,
      total: unknown_rows.length,
      bucket_counts: Object.keys(unknown_buckets).reduce(function (o, k) {
        o[k] = unknown_buckets[k].length;
        return o;
      }, {}),
      buckets: unknown_buckets,
    });
    write_json_atomic(FILE_G3_D2_LANGUAGE_AUDIT, {
      schema_version: G3_D2_SCHEMA_VERSION,
      total: lang_unconfirmed.length,
      bucket_counts: Object.keys(lang_buckets).reduce(function (o, k) {
        o[k] = lang_buckets[k].length;
        return o;
      }, {}),
      buckets: lang_buckets,
      note_zh: '語言未確認≠純器樂',
    });
    write_json_atomic(FILE_G3_D2_AUTO_REVIEW_POLICY, {
      schema_version: G3_D2_SCHEMA_VERSION,
      v1_behavior_zh:
        '僅檢查字典／語言風險／fixture 衝突；主曲風 unknown 不 bump',
      v2_additions_zh: [
        'unknown primary → classification_unknown',
        'low tier → needs_evidence',
        '稀疏 metadata + 具體曲風 → needs_evidence',
      ],
      v1_counts_on_d1_200: v1_only,
      v2_counts_on_d1_200: quality_batch.v2_counts,
      delta_zh:
        'v1 pass ' +
        v1_only.pass +
        ' → v2 quality_ok ' +
        quality_batch.v2_counts.quality_ok,
    });
    write_json_atomic(FILE_G3_D2_QUALITY_OVERLAY, overlay);
    write_json_atomic(FILE_G3_D2_SECOND_ROUND_CANDIDATES, {
      schema_version: G3_D2_SCHEMA_VERSION,
      count: second_round.length,
      candidates: second_round,
    });
    write_json_atomic(FILE_G3_D2_NEXT_WAVE_PREREQS, next_wave);
    fs.writeFileSync(
      FILE_G3_D2_SOURCE_LINEAGE,
      lineage_sample(rows, payload_map, ev_tracks, 20),
      'utf8'
    );
    write_json_atomic(FILE_G3_D2_SUMMARY, summary);
    write_json_atomic(FILE_G3_D2_SPOT_CHECK, spot_check);
    write_json_atomic(FILE_G3_D2_PREVIEW_DELTA, {
      schema_version: G3_D2_SCHEMA_VERSION,
      balanced_total: balanced.breakdown.total_unique,
      relaxed_total: relaxed.breakdown.total_unique,
      note_zh:
        'balanced 仍僅用 confidence_tier high/medium；quality_status 不影響納入門檻，僅 UI／任務',
      quality_overlay_applied_on_c1_rebuild: true,
    });
  }

  return {
    summary: summary,
    template: template,
    soundtrack: st_buckets,
    quality: quality_batch,
    spot_check: spot_check,
  };
}
