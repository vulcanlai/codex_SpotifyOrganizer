/**
 * G3-C.1 統一分類檢視索引（欄位級優先權）
 */
import fs from 'node:fs';
import { write_json_atomic } from '../../atomic_json.js';
import { FILE_CLASSIFICATION_INDEX } from '../paths.js';
import { load_g3_source_bundle } from '../g3_evidence/source_loaders.js';
import { file_g3_evidence_index } from '../g3_evidence/paths.js';
import { resolve_human_confirmation } from '../g3_evidence/human_confirmation.js';
import { rule_classify_track } from '../g3_b/rule_classify.js';
import { auto_review_ai_draft_row } from '../g3_b/auto_review.js';
import { auto_review_ai_draft_with_quality } from '../g3_d/auto_review_quality.js';
import { FILE_G3_D2_QUALITY_OVERLAY } from '../g3_d/paths_d2.js';
import { load_g3_b_ai_catalog } from './load_g3_b_ai_catalog.js';
import { genre_profile_from_ai_candidate } from '../genre_profile.js';
import {
  G3_C1_DIR,
  FILE_G3_C1_UNIFIED_INDEX,
  FILE_G3_C1_UNIFIED_SUMMARY,
  G3_C1_SCHEMA_VERSION,
  SOURCE_TIER_HUMAN,
  SOURCE_TIER_EVIDENCE,
  SOURCE_TIER_AI,
  SOURCE_TIER_RULE,
  SOURCE_TIER_UNKNOWN,
} from './paths_c1.js';
import { GENRE_PRIMARY_UNKNOWN } from '../genre_taxonomy.js';
import { resolve_effective_inference_for_unified_view } from '../g3_d/g3_d4_inference_display.js';

function field_cell(value, tier, detail, confidence) {
  return {
    value: value,
    source_tier: tier,
    source_detail: detail || null,
    confidence: confidence || 'unknown',
  };
}

function tags_for_dimension(tags, dimension) {
  const out = [];
  for (let i = 0; i < (tags || []).length; i += 1) {
    if (tags[i].dimension === dimension) {
      out.push(tags[i]);
    }
  }
  return out;
}

function has_reliable_mb_genre_tags(ev) {
  const facts = ev.facts || [];
  for (let i = 0; i < facts.length; i += 1) {
    if (
      facts[i].field === 'musicbrainz_genre_tags' &&
      facts[i].is_direct_fact &&
      !facts[i].pending_verification
    ) {
      return true;
    }
  }
  return false;
}

function resolve_genre(index_row, human, ai_pack, rule_draft, track_id) {
  if (human.locked && human.genre_profile && human.genre_profile.primary_genre) {
    return {
      primary_genre: field_cell(
        human.genre_profile.primary_genre,
        SOURCE_TIER_HUMAN,
        human.sources.join(';'),
        'confirmed'
      ),
      subgenres: field_cell(
        human.genre_profile.subgenres || [],
        SOURCE_TIER_HUMAN,
        'manual_or_accepted_review',
        'confirmed'
      ),
      secondary_genres: field_cell(
        human.genre_profile.secondary_genres || [],
        SOURCE_TIER_HUMAN,
        'manual_or_accepted_review',
        'confirmed'
      ),
    };
  }
  if (ai_pack && ai_pack.row.genre_profile) {
    const gp = ai_pack.row.genre_profile;
    const inf = resolve_effective_inference_for_unified_view(track_id, ai_pack);
    const tier = inf.display_tier;
    const detail = inf.display_detail;
    return {
      primary_genre: field_cell(
        gp.primary_genre || GENRE_PRIMARY_UNKNOWN,
        tier,
        detail,
        gp.confidence || ai_pack.row.confidence || 'inferred'
      ),
      subgenres: field_cell(gp.subgenres || [], tier, detail, 'inferred'),
      secondary_genres: field_cell(
        gp.secondary_genres || [],
        tier,
        detail,
        'inferred'
      ),
    };
  }
  const cand = index_row && index_row.genre_profile;
  if (cand && cand.primary_genre && cand.primary_genre !== GENRE_PRIMARY_UNKNOWN) {
    return {
      primary_genre: field_cell(cand.primary_genre, SOURCE_TIER_RULE, 'classification-index', 'inferred'),
      subgenres: field_cell(cand.subgenres || [], SOURCE_TIER_RULE, 'classification-index', 'inferred'),
      secondary_genres: field_cell(
        cand.secondary_genres || [],
        SOURCE_TIER_RULE,
        'classification-index',
        'inferred'
      ),
    };
  }
  const rgp = rule_draft.genre_profile || {};
  return {
    primary_genre: field_cell(
      rgp.primary_genre || GENRE_PRIMARY_UNKNOWN,
      SOURCE_TIER_RULE,
      'g3_b_rule_draft',
      'unknown'
    ),
    subgenres: field_cell([], SOURCE_TIER_UNKNOWN, null, 'unknown'),
    secondary_genres: field_cell([], SOURCE_TIER_UNKNOWN, null, 'unknown'),
  };
}

function resolve_language(index_row, human, ai_pack, rule_draft, track_id) {
  if (human.locked && human.manual_tags) {
    const lang_tags = human.manual_tags.filter(function (t) {
      return t.dimension === 'language';
    });
    if (lang_tags.length) {
      return field_cell(lang_tags[0].value, SOURCE_TIER_HUMAN, 'manual_tag', 'confirmed');
    }
  }
  if (ai_pack && ai_pack.row.language) {
    const lang = ai_pack.row.language;
    const inf = resolve_effective_inference_for_unified_view(track_id, ai_pack);
    return field_cell(
      lang.value || '未確認',
      inf.display_tier,
      inf.display_detail,
      lang.confidence || 'inferred'
    );
  }
  const rule_lang = rule_draft.language || {};
  if (rule_lang.value && rule_lang.value !== '未確認') {
    return field_cell(rule_lang.value, SOURCE_TIER_RULE, 'rule_classify', rule_lang.confidence || 'inferred');
  }
  const tags = tags_for_dimension(index_row.tags, 'language');
  if (tags.length && tags[0].value !== '未確認') {
    return field_cell(tags[0].value, SOURCE_TIER_RULE, 'index_tag', tags[0].confidence || 'inferred');
  }
  return field_cell('未確認', SOURCE_TIER_UNKNOWN, null, 'unknown');
}

function resolve_contexts(ai_pack) {
  if (ai_pack && ai_pack.row.contexts && ai_pack.row.contexts.length) {
    return field_cell(
      ai_pack.row.contexts.map(function (c) {
        return c.value;
      }),
      SOURCE_TIER_AI,
      ai_pack.source,
      'inferred'
    );
  }
  return field_cell([], SOURCE_TIER_UNKNOWN, null, 'unknown');
}

function resolve_special_types(index_row, ai_pack) {
  if (ai_pack && ai_pack.row.special_types && ai_pack.row.special_types.length) {
    return field_cell(
      ai_pack.row.special_types.map(function (s) {
        return s.value || s;
      }),
      SOURCE_TIER_AI,
      ai_pack.source,
      'inferred'
    );
  }
  const tags = tags_for_dimension(index_row.tags, 'special_type');
  if (tags.length) {
    return field_cell(
      tags.map(function (t) {
        return t.value;
      }),
      SOURCE_TIER_RULE,
      'index_tag',
      'inferred'
    );
  }
  return field_cell([], SOURCE_TIER_UNKNOWN, null, 'unknown');
}

/**
 * @param {{ write?: boolean }} [opts]
 */
export function build_unified_classification_view(opts) {
  const options = opts || {};
  const write = options.write !== false;

  const index_doc = JSON.parse(fs.readFileSync(FILE_CLASSIFICATION_INDEX, 'utf8'));
  const ev_doc = JSON.parse(fs.readFileSync(file_g3_evidence_index(), 'utf8'));
  const bundle = load_g3_source_bundle();
  const catalog = load_g3_b_ai_catalog();

  /** @type {Record<string, object>|null} */
  let quality_overlay = null;
  if (fs.existsSync(FILE_G3_D2_QUALITY_OVERLAY)) {
    const ov = JSON.parse(fs.readFileSync(FILE_G3_D2_QUALITY_OVERLAY, 'utf8'));
    quality_overlay = {};
    const list = ov.tracks || [];
    for (let q = 0; q < list.length; q += 1) {
      quality_overlay[list[q].track_id] = list[q];
    }
  }

  const tracks_by_id = index_doc.tracks_by_id || {};
  const ids = Object.keys(tracks_by_id).sort();
  /** @type {Record<string, object>} */
  const view_tracks = {};

  let ai_integrated_100 = 0;
  let ai_integrated_200 = 0;
  let g3_ai_catalog_count = 0;
  let human_locked_count = 0;
  let with_external_identity = 0;

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const index_row = tracks_by_id[id];
    const ev = ev_doc.tracks[id] || null;
    const rule = ev ? rule_classify_track(ev) : null;
    const human = resolve_human_confirmation(id, {
      index_row: index_row,
      overrides_doc: bundle.manual_overrides,
      v2_review: bundle.ai_review_by_id[id] ? bundle.ai_review_by_id[id].review : null,
    });

    const ai_pack = catalog.by_id[id] || null;
    if (ai_pack) {
      g3_ai_catalog_count += 1;
    }
    if (catalog.sample_100_ids.indexOf(id) >= 0 && ai_pack) {
      ai_integrated_100 += 1;
    }
    if (catalog.sample_200_ids && catalog.sample_200_ids.indexOf(id) >= 0 && ai_pack) {
      ai_integrated_200 += 1;
    }
    if (human.locked) {
      human_locked_count += 1;
    }

    const v = ev ? ev.verification_status || {} : {};
    const ext_id =
      (v.g2 && v.g2.verify_status === 'matched') ||
      (v.g1 && v.g1.verify_status === 'matched');
    if (ext_id) {
      with_external_identity += 1;
    }

    const genre = resolve_genre(index_row, human, ai_pack, rule || {}, id);
    const language = resolve_language(index_row, human, ai_pack, rule || {}, id);
    const inference_display = resolve_effective_inference_for_unified_view(id, ai_pack);
    const contexts = resolve_contexts(ai_pack);
    const special_types = resolve_special_types(index_row, ai_pack);

    let auto_review = null;
    let ai_tier = null;
    let missing_fields = [];
    let version_uncertainty = false;
    let conflicts = [];

    let auto_review_quality = null;
    if (ai_pack && ev) {
      auto_review = auto_review_ai_draft_row(ev, rule, ai_pack.row);
      auto_review_quality = auto_review_ai_draft_with_quality(ev, rule, ai_pack.row);
      ai_tier = ai_pack.row.confidence_tier || null;
      missing_fields = ai_pack.row.unverified_fields || [];
      version_uncertainty = ai_pack.row.version_uncertainty === true;
      if (auto_review.status === 'conflict') {
        conflicts.push({
          field: 'multiple',
          reason_zh: (auto_review.issues || []).join('；'),
        });
      }
    }

    const disp = index_row.display || {};
    view_tracks[id] = {
      spotify_id: id,
      title: disp.name || (ev && ev.identity ? ev.identity.title : null),
      artists: disp.artists || (ev && ev.identity ? ev.identity.artists : []),
      metadata_status: index_row.metadata_status,
      primary_genre: genre.primary_genre,
      subgenres: genre.subgenres,
      secondary_genres: genre.secondary_genres,
      language: language,
      contexts: contexts,
      special_types: special_types,
      classification_source: ai_pack ? ai_pack.source : human.locked ? 'human' : 'rule_or_unknown',
      inference_source_kind: inference_display.inference_source_kind,
      classification_display_tier: inference_display.display_tier,
      is_cursor_agent_ai: inference_display.is_cursor_agent_ai,
      human_confirmed: human.locked,
      human_sources: human.sources.slice(),
      has_external_identity_evidence: ext_id,
      has_external_genre_evidence: ev ? has_reliable_mb_genre_tags(ev) : false,
      ai_confidence_tier: ai_tier,
      auto_review_status: auto_review ? auto_review.status : null,
      auto_review_issues: auto_review ? auto_review.issues : [],
      auto_review_structural_status: auto_review_quality
        ? auto_review_quality.structural_status
        : null,
      auto_review_quality_status: auto_review_quality
        ? auto_review_quality.quality_status
        : quality_overlay && quality_overlay[id]
          ? quality_overlay[id].quality_status
          : null,
      auto_review_quality_issues: auto_review_quality
        ? auto_review_quality.quality_issues
        : quality_overlay && quality_overlay[id]
          ? quality_overlay[id].quality_issues
          : [],
      missing_evidence_fields: missing_fields,
      version_uncertainty: version_uncertainty,
      conflicts: conflicts,
      in_g3_sample_100: catalog.sample_100_ids.indexOf(id) >= 0,
      in_g3_d1_wave_200:
        catalog.sample_200_ids && catalog.sample_200_ids.indexOf(id) >= 0,
    };
  }

  const doc = {
    schema_version: G3_C1_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    track_count: ids.length,
    g3_sample_100_count: catalog.sample_100_ids.length,
    g3_d1_wave_200_count: catalog.sample_200_ids ? catalog.sample_200_ids.length : 0,
    g3_ai_integrated_in_sample_100: ai_integrated_100,
    g3_ai_integrated_in_d1_wave_200: ai_integrated_200,
    g3_ai_catalog_track_count: g3_ai_catalog_count,
    tracks: view_tracks,
  };

  const summary = {
    schema_version: G3_C1_SCHEMA_VERSION,
    generated_at: doc.generated_at,
    track_count: ids.length,
    g3_ai_integrated_in_sample_100: ai_integrated_100,
    g3_ai_integrated_in_d1_wave_200: ai_integrated_200,
    g3_ai_catalog_track_count: g3_ai_catalog_count,
    human_locked_count: human_locked_count,
    with_external_identity_evidence: with_external_identity,
    sample_100_with_ai: ai_integrated_100,
    rebuild_note_zh: '衍生資料；可從 G3-A/B 來源重建；不修改 manual-overrides 或正式 state',
  };

  if (write) {
    if (!fs.existsSync(G3_C1_DIR)) {
      fs.mkdirSync(G3_C1_DIR, { recursive: true });
    }
    write_json_atomic(FILE_G3_C1_UNIFIED_INDEX, doc);
    write_json_atomic(FILE_G3_C1_UNIFIED_SUMMARY, summary);
  }

  return { doc: doc, summary: summary };
}

export function load_unified_classification_view() {
  if (!fs.existsSync(FILE_G3_C1_UNIFIED_INDEX)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(FILE_G3_C1_UNIFIED_INDEX, 'utf8'));
}
