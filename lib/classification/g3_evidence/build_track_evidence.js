/**
 * 單曲 G3 證據文件
 */
import { evidence_entry, EVIDENCE_PRIORITY, verification_layer_summary } from './provenance.js';
import {
  verification_row_to_layer,
  g2_1_layer_from_replay,
} from './source_loaders.js';
import { ARTIST_MATCH_STATUS } from '../../enrichment/external/artist_evidence.js';
import { resolve_human_confirmation } from './human_confirmation.js';

/**
 * @param {string} track_id
 * @param {object} bundle
 */
export function build_track_evidence_doc(track_id, bundle) {
  const index_row = bundle.index.tracks_by_id[track_id];
  if (!index_row) {
    return null;
  }

  const disp = index_row.display || {};
  const merged = index_row.merged_metadata || {};
  const cache =
    bundle.metadata_cache && bundle.metadata_cache.tracks_by_id
      ? bundle.metadata_cache.tracks_by_id[track_id]
      : null;

  const formal =
    bundle.formal_state && bundle.formal_state.states_by_track_id
      ? bundle.formal_state.states_by_track_id[track_id]
      : null;

  const override_row =
    bundle.manual_overrides.overrides_by_track_id[track_id] || null;

  const g1_row =
    bundle.g1_verification && bundle.g1_verification.tracks
      ? bundle.g1_verification.tracks[track_id]
      : null;
  const g2_row =
    bundle.g2_verification && bundle.g2_verification.tracks
      ? bundle.g2_verification.tracks[track_id]
      : null;
  const g2_1_replay = bundle.g2_1_by_id[track_id] || null;

  const in_mb_sample = !!bundle.sample_sets.g1_g2[track_id];
  const ai_pack = bundle.ai_candidate_by_id[track_id] || null;
  const ai_rev = bundle.ai_review_by_id[track_id] || null;

  /** @type {object[]} */
  const evidence = [];
  /** @type {object[]} */
  const facts = [];
  /** @type {object[]} */
  const conflicts = [];
  /** @type {string[]} */
  const missing_fields = [];

  function push_ev(e) {
    evidence.push(e);
    if (e.is_direct_fact && !e.is_ai_candidate) {
      facts.push(e);
    }
  }

  push_ev(
    evidence_entry({
      field: 'title',
      value: disp.name || merged.name || null,
      source: 'classification_index',
      source_ref: bundle.source_refs.classification_index,
      is_direct_fact: true,
      priority_rank: EVIDENCE_PRIORITY.sourced_fact,
    })
  );

  push_ev(
    evidence_entry({
      field: 'artists',
      value: (disp.artists || merged.artists || []).slice(),
      source: 'classification_index',
      source_ref: bundle.source_refs.classification_index,
      is_direct_fact: true,
      priority_rank: EVIDENCE_PRIORITY.sourced_fact,
    })
  );

  push_ev(
    evidence_entry({
      field: 'album_name',
      value: disp.album_name || merged.album_name || null,
      source: 'classification_index',
      source_ref: bundle.source_refs.classification_index,
      is_direct_fact: true,
      priority_rank: EVIDENCE_PRIORITY.sourced_fact,
    })
  );

  if (cache) {
    if (cache.isrc) {
      push_ev(
        evidence_entry({
          field: 'isrc',
          value: cache.isrc,
          source: 'spotify_metadata_cache',
          source_ref: bundle.source_refs.track_metadata_cache,
          obtained_at: cache.fetched_at || null,
          is_direct_fact: true,
          priority_rank: EVIDENCE_PRIORITY.sourced_fact,
        })
      );
    } else {
      missing_fields.push('isrc');
    }
    push_ev(
      evidence_entry({
        field: 'duration_ms',
        value: cache.duration_ms != null ? cache.duration_ms : null,
        source: 'spotify_metadata_cache',
        source_ref: bundle.source_refs.track_metadata_cache,
        obtained_at: cache.fetched_at || null,
        is_direct_fact: true,
        priority_rank: EVIDENCE_PRIORITY.sourced_fact,
      })
    );
  } else {
    missing_fields.push('spotify_metadata_cache');
    if (!merged.duration_ms) {
      missing_fields.push('duration_ms');
    }
  }

  const release_date = disp.release_date || merged.release_date || null;
  if (release_date) {
    push_ev(
      evidence_entry({
        field: 'release_date',
        value: release_date,
        source: 'classification_index',
        source_ref: bundle.source_refs.classification_index,
        is_direct_fact: true,
        priority_rank: EVIDENCE_PRIORITY.sourced_fact,
      })
    );
  }

  const tags = index_row.tags || [];
  for (let t = 0; t < tags.length; t += 1) {
    const tag = tags[t];
    if (!tag || !tag.dimension) {
      continue;
    }
    const is_manual = !!tag.is_manual_override;
    push_ev(
      evidence_entry({
        field: 'classification_tag:' + tag.dimension,
        value: tag.value,
        source: tag.source || 'classification_index',
        source_ref: bundle.source_refs.classification_index,
        is_direct_fact: !tag.method || tag.method.indexOf('default') < 0,
        is_inference: tag.confidence === 'inferred' || tag.method === 'default_unknown',
        priority_rank: is_manual
          ? EVIDENCE_PRIORITY.manual_confirmed
          : tag.confidence === 'inferred'
            ? EVIDENCE_PRIORITY.rule_inference
            : EVIDENCE_PRIORITY.sourced_fact,
        note: tag.evidence || null,
      })
    );
  }

  if (override_row) {
    push_ev(
      evidence_entry({
        field: 'manual_override',
        value: override_row,
        source: 'manual_overrides',
        source_ref: 'backup/classification/manual-overrides.json',
        is_direct_fact: true,
        priority_rank: EVIDENCE_PRIORITY.manual_confirmed,
        note: '人工覆寫優先於 AI 建議；不刪除其他來源',
      })
    );
  }

  const g1_layer = in_mb_sample
    ? verification_row_to_layer(g1_row, 'g1', bundle.source_refs.g1_verification)
    : null;
  const g2_layer = in_mb_sample
    ? verification_row_to_layer(g2_row, 'g2', bundle.source_refs.g2_verification)
    : null;
  const g2_1_layer = in_mb_sample
    ? g2_1_layer_from_replay(
        g2_1_replay,
        g2_row,
        bundle.source_refs.g2_1_offline_replay
      )
    : null;

  if (!in_mb_sample) {
    missing_fields.push('musicbrainz_verification');
  } else {
    attach_mb_layers(g1_layer, g2_layer, g2_1_layer, g1_row, g2_row, push_ev, conflicts);
  }

  /** @type {object[]} */
  const classification_candidates = [];
  if (ai_pack) {
    const c = ai_pack.candidate;
    classification_candidates.push({
      batch_id: ai_pack.batch_id,
      candidate: c,
      is_fact: false,
      for_ai_automation_only: true,
      review_status: ai_rev && ai_rev.review ? ai_rev.review.status : 'unknown',
    });
    push_ev(
      evidence_entry({
        field: 'ai_classification_candidate',
        value: {
          primary_genre: c.primary_genre,
          language: c.language,
          sub_genres: c.sub_genres,
        },
        source: 'ai_candidates_' + ai_pack.batch_id,
        source_ref: ai_pack.batch_id,
        is_direct_fact: false,
        is_ai_candidate: true,
        is_inference: true,
        priority_rank: EVIDENCE_PRIORITY.ai_suggestion,
        note: 'AI 建議非確定事實；自動分類時須與人工狀態分離',
      })
    );
  }

  if (formal) {
    push_ev(
      evidence_entry({
        field: 'formal_classification_state',
        value: formal.formal_state,
        source: 'formal_classification_state',
        source_ref: bundle.source_refs.formal_classification_state,
        is_direct_fact: true,
        priority_rank:
          formal.formal_state === 'confirmed'
            ? EVIDENCE_PRIORITY.manual_confirmed
            : formal.formal_state === 'ai_suggested'
              ? EVIDENCE_PRIORITY.ai_suggestion
              : EVIDENCE_PRIORITY.unknown,
        note: formal.confidence_reasons
          ? formal.confidence_reasons.join('；')
          : null,
      })
    );
  }

  if (g1_layer && g2_layer && g1_layer.verify_status !== g2_layer.verify_status) {
    conflicts.push({
      kind: 'verification_g1_vs_g2',
      g1: g1_layer.verify_status,
      g2: g2_layer.verify_status,
      note: '保留兩版原始查證，不覆寫',
    });
  }
  if (g2_layer && g2_1_layer && g2_layer.verify_status !== g2_1_layer.verify_status) {
    conflicts.push({
      kind: 'verification_g2_vs_g2_1_offline',
      g2: g2_layer.verify_status,
      g2_1_offline: g2_1_layer.verify_status,
      note: 'G2.1 為離線重算，非新線上查詢',
    });
  }

  const human = resolve_human_confirmation(track_id, {
    index_row: index_row,
    overrides_doc: bundle.manual_overrides,
    v2_review: bundle.ai_review_by_id[track_id]
      ? bundle.ai_review_by_id[track_id].review
      : null,
    phase_review:
      bundle.ai_review_by_id[track_id] &&
      bundle.ai_review_by_id[track_id].batch_id === 'phase-e-100'
        ? bundle.ai_review_by_id[track_id].review
        : null,
  });

  const priority_resolution = resolve_priority(
    human,
    formal,
    g2_1_layer,
    g2_layer
  );

  if (human.locked) {
    push_ev(
      evidence_entry({
        field: 'human_confirmation',
        value: {
          locked: true,
          sources: human.sources,
          review_status: human.review_status,
          genre_profile: human.genre_profile,
        },
        source: human.sources[0] || 'human_confirmation',
        source_ref: human.sources.join(';'),
        is_direct_fact: true,
        priority_rank: EVIDENCE_PRIORITY.manual_confirmed,
        note: '人工確認或已接受審核；AI 自動分類不得覆寫',
      })
    );
  }

  return {
    track_id: track_id,
    identity: {
      title: disp.name || null,
      artists: (disp.artists || []).slice(),
      album_name: disp.album_name || null,
      isrc: cache && cache.isrc ? cache.isrc : g1_row && g1_row.source_isrc ? g1_row.source_isrc : null,
      release_date: release_date,
      metadata_status: index_row.metadata_status || 'unknown',
      enrichment_cache_complete: index_row.enrichment_cache_complete === true,
    },
    verification_status: {
      g1: verification_layer_summary(g1_layer),
      g2: verification_layer_summary(g2_layer),
      g2_1_offline: verification_layer_summary(g2_1_layer),
      in_musicbrainz_sample: in_mb_sample,
    },
    facts: facts,
    evidence: evidence,
    classification_candidates: classification_candidates,
    conflicts: conflicts,
    missing_fields: missing_fields,
    priority_resolution: priority_resolution,
    human_confirmation: {
      locked: human.locked,
      sources: human.sources.slice(),
      review_status: human.review_status,
    },
  };
}

function attach_mb_layers(g1_layer, g2_layer, g2_1_layer, g1_row, g2_row, push_ev, conflicts) {
  const layers = [
    { layer: g1_layer, row: g1_row, source: 'musicbrainz_g1' },
    { layer: g2_layer, row: g2_row, source: 'musicbrainz_g2' },
    { layer: g2_1_layer, row: null, source: 'musicbrainz_g2_1_offline' },
  ];

  for (let i = 0; i < layers.length; i += 1) {
    const L = layers[i];
    if (!L.layer) {
      continue;
    }
    const row = L.row;
    const best = row && row.best_match ? row.best_match : null;
    const reliable_matched =
      L.layer.verify_status === 'matched' &&
      !L.layer.pending_verification &&
      L.layer.artist_match_status !== ARTIST_MATCH_STATUS.unverified_cross_script;

    if (best && L.layer.verify_status === 'matched') {
      const tags = best.tags || [];
      if (tags.length) {
        push_ev(
          evidence_entry({
            field: 'musicbrainz_genre_tags',
            value: tags.slice(),
            source: L.source,
            source_ref: L.layer.source_ref,
            obtained_at: L.layer.obtained_at,
            is_direct_fact: reliable_matched,
            is_inference: !reliable_matched,
            pending_verification: !reliable_matched,
            priority_rank: reliable_matched
              ? EVIDENCE_PRIORITY.sourced_fact
              : EVIDENCE_PRIORITY.rule_inference,
            note: reliable_matched
              ? null
              : '查證未可靠 matched 或藝人未核實；標籤僅供參考',
          })
        );
      }
      if (reliable_matched) {
        push_ev(
          evidence_entry({
            field: 'musicbrainz_recording',
            value: {
              recording_id: best.external_id,
              title: best.title,
              artists: best.artist_names,
              source_url: best.source_url,
            },
            source: L.source,
            source_ref: L.layer.source_ref,
            obtained_at: L.layer.obtained_at,
            is_direct_fact: true,
            priority_rank: EVIDENCE_PRIORITY.sourced_fact,
          })
        );
      } else {
        push_ev(
          evidence_entry({
            field: 'musicbrainz_recording_candidate',
            value: {
              recording_id: best.external_id,
              title: best.title,
              artists: best.artist_names,
              verify_status: L.layer.verify_status,
              match_tier: L.layer.match_tier,
            },
            source: L.source,
            source_ref: L.layer.source_ref,
            is_direct_fact: false,
            pending_verification: true,
            priority_rank: EVIDENCE_PRIORITY.rule_inference,
            note: L.layer.note,
          })
        );
      }
    }

    push_ev(
      evidence_entry({
        field: 'verification_summary',
        value: L.layer,
        source: L.source,
        source_ref: L.layer.source_ref,
        is_direct_fact: false,
        is_inference: false,
        pending_verification: L.layer.pending_verification,
        priority_rank: EVIDENCE_PRIORITY.sourced_fact,
      })
    );
  }

  push_ev(
    evidence_entry({
      field: 'vocal_language_evidence',
      value: 'unknown',
      source: 'classification_rules',
      is_direct_fact: false,
      is_inference: false,
      priority_rank: EVIDENCE_PRIORITY.unknown,
      note: 'G1/G2 不憑歌名推斷演唱語言；待 G3-B 整合多來源',
    })
  );
}

function resolve_priority(human, formal, g2_1_layer, g2_layer) {
  if (human && human.locked) {
    const from_override_file =
      human.sources && human.sources.indexOf('manual-overrides.json') >= 0;
    return {
      effective_for_classification: from_override_file
        ? 'manual_override'
        : 'human_confirmed',
      rank: EVIDENCE_PRIORITY.manual_confirmed,
      note: from_override_file
        ? 'manual-overrides.json 覆寫'
        : '人工確認／已接受審核／索引人工標籤',
      sources: human.sources,
    };
  }
  if (formal && formal.formal_state === 'confirmed') {
    return {
      effective_for_classification: 'confirmed',
      rank: EVIDENCE_PRIORITY.manual_confirmed,
    };
  }
  if (formal && formal.formal_state === 'ai_suggested') {
    return {
      effective_for_classification: 'ai_suggested',
      rank: EVIDENCE_PRIORITY.ai_suggestion,
      note: '未審核 AI 不得視為 confirmed',
    };
  }
  if (g2_1_layer && g2_1_layer.verify_status === 'matched') {
    return {
      effective_for_classification: 'external_facts_g2_1',
      rank: EVIDENCE_PRIORITY.sourced_fact,
      note:
        g2_1_layer.artist_match_status === 'unverified_cross_script'
          ? 'ISRC/錄音可參考；藝人未核實不提升 AI 可信度'
          : null,
    };
  }
  if (g2_layer && g2_layer.verify_status === 'matched') {
    return {
      effective_for_classification: 'external_facts_g2',
      rank: EVIDENCE_PRIORITY.sourced_fact,
    };
  }
  return {
    effective_for_classification: 'unknown',
    rank: EVIDENCE_PRIORITY.unknown,
  };
}
