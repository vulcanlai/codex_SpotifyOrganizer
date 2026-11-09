import { load_full_library_inference, apply_full_library_inference, merge_additional_inference_tracks } from './full_library_inference.js';
import { load_rules as load_managed_playlist_rules } from '../managed_playlists/stores.js';
/**
 * 建立 classification-index 與 summary
 */
import fs from 'node:fs';
import { load_library_v2_for_probe } from '../probe/library_v2_select.js';
import { load_track_cache } from '../enrichment/storage.js';
import { FILE_LIBRARY_V2 } from '../merge/v2/paths.js';
import { FILE_TRACK_CACHE } from '../enrichment/paths.js';
import { write_json_atomic } from '../atomic_json.js';
import {
  CLASSIFICATION_DIR,
  FILE_CLASSIFICATION_INDEX,
  FILE_CLASSIFICATION_SUMMARY,
  CLASSIFICATION_INDEX_SCHEMA_VERSION,
  CLASSIFICATION_SUMMARY_SCHEMA_VERSION,
  GENRE_TAXONOMY_VERSION,
} from './paths.js';
import { load_manual_overrides } from './overrides_store.js';
import { build_merged_track_record } from './merge_sources.js';
import { classify_track_auto } from './classify_track.js';
import { apply_manual_overrides_to_tags } from './apply_overrides.js';
import { load_g3_f_adopt_registry } from './g3_f/g3_f_adopt_registry_store.js';
import { apply_g3_f_adopt_registry_to_tags } from './g3_f/apply_g3_f_adopt_registry.js';
import {
  DIMENSION_DECADE,
  DIMENSION_LANGUAGE,
  DIMENSION_GENRE,
  DIMENSION_CONTEXT,
  DIMENSION_SPECIAL,
  DECADE_VALUES,
} from './dimensions.js';
import {
  build_track_genre_profile,
  count_primary_genre_tracks,
  count_subgenre_tracks,
} from './genre_profile.js';
import { build_formal_classification_state } from './formal_state_build.js';
import { manual_membership_from_override_row } from './manual_classify/override_patch.js';
export class ClassificationBuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ClassificationBuildError';
  }
}

function count_tags_by_dimension(tracks_by_id, dimension) {
  const counts = {};
  const ids = Object.keys(tracks_by_id);
  for (let i = 0; i < ids.length; i += 1) {
    const tags = tracks_by_id[ids[i]].tags || [];
    for (let t = 0; t < tags.length; t += 1) {
      const tag = tags[t];
      if (tag.dimension !== dimension) {
        continue;
      }
      counts[tag.value] = (counts[tag.value] || 0) + 1;
    }
  }
  return counts;
}

function count_tracks_with_dimension_value(tracks_by_id, dimension, value) {
  let n = 0;
  const ids = Object.keys(tracks_by_id);
  for (let i = 0; i < ids.length; i += 1) {
    const tags = tracks_by_id[ids[i]].tags || [];
    for (let t = 0; t < tags.length; t += 1) {
      if (tags[t].dimension === dimension && tags[t].value === value) {
        n += 1;
        break;
      }
    }
  }
  return n;
}

/**
 * @param {object} [opts]
 */
export function build_classification_index(opts) {
  const options = opts || {};
  const loaded = load_library_v2_for_probe();
  let track_index = loaded.track_index;
  const cache_doc = options.cache_doc || load_track_cache();
  const overrides_doc = options.overrides_doc || load_manual_overrides();
  const registry_doc =
    options.g3_f_registry_doc !== undefined
      ? options.g3_f_registry_doc
      : load_g3_f_adopt_registry();
  const adoptions_by_id = registry_doc.adoptions_by_track_id || {};
  const cache_by_id = cache_doc.tracks_by_id || {};

  const full_inference = options.full_inference_doc === undefined ? load_full_library_inference() : options.full_inference_doc;
  track_index = merge_additional_inference_tracks(track_index, full_inference, loaded.library_v2_doc.user_id);
  let managed_rules = options.managed_rules_doc;
  if (managed_rules === undefined) {
    try {
      managed_rules = load_managed_playlist_rules();
    } catch {
      managed_rules = null;
    }
  }
  if (
    managed_rules &&
    managed_rules.additional_track_index_by_id &&
    Object.keys(managed_rules.additional_track_index_by_id).length &&
    (managed_rules.additional_tracks_user_id || managed_rules.account_id) ===
      loaded.library_v2_doc.user_id
  ) {
    track_index = merge_additional_inference_tracks(
      track_index,
      {
        additional_track_index_by_id: managed_rules.additional_track_index_by_id,
        additional_tracks_user_id: managed_rules.additional_tracks_user_id || managed_rules.account_id,
      },
      loaded.library_v2_doc.user_id
    );
  }
  const ids = Object.keys(track_index).sort();
  /** @type {Record<string, object>} */
  const tracks_out = {};

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const merged = build_merged_track_record(track_index[id], cache_by_id[id] || null);
    const auto_tags = classify_track_auto(merged);
    const override_row = overrides_doc.overrides_by_track_id[id] || null;
    const registry_entry = adoptions_by_id[id] || null;
    let tags = apply_manual_overrides_to_tags(auto_tags, override_row);
    tags = apply_g3_f_adopt_registry_to_tags(tags, registry_entry, override_row);
    const genre_profile = build_track_genre_profile(
      tags,
      override_row,
      registry_entry
    );
    const manual_playlist_membership = manual_membership_from_override_row(override_row);
    const track_row = {
      spotify_id: id,
      metadata_status: merged.metadata_status,
      enrichment_cache_complete: merged.enrichment_cache_complete,
      display: merged.display,
      merged_metadata: merged.merged_metadata,
      metadata_conflicts: merged.metadata_conflicts,
      appearances: merged.appearances,
      tags,
      genre_profile,
    };
    if (manual_playlist_membership) {
      track_row.manual_playlist_membership = manual_playlist_membership;
    }
    tracks_out[id] = apply_full_library_inference(track_row, full_inference, {manual_protected: Boolean(override_row)});
  }

  const now = new Date().toISOString();
  const index_doc = {
    schema_version: CLASSIFICATION_INDEX_SCHEMA_VERSION,
    genre_taxonomy_version: GENRE_TAXONOMY_VERSION,
    updated_at: now,
    build_source: {
      library_v2: FILE_LIBRARY_V2,
      enrichment_cache: FILE_TRACK_CACHE,
    },
    track_count: ids.length,
    tracks_by_id: tracks_out,
  };

  let metadata_complete = 0;
  let metadata_missing = 0;
  for (let j = 0; j < ids.length; j += 1) {
    if (tracks_out[ids[j]].metadata_status === 'complete') {
      metadata_complete += 1;
    } else {
      metadata_missing += 1;
    }
  }

  const decade_counts = count_tags_by_dimension(tracks_out, DIMENSION_DECADE);
  const language_counts = count_tags_by_dimension(tracks_out, DIMENSION_LANGUAGE);
  const genre_counts = count_tags_by_dimension(tracks_out, DIMENSION_GENRE);
  const context_counts = count_tags_by_dimension(tracks_out, DIMENSION_CONTEXT);
  const special_counts = count_tags_by_dimension(tracks_out, DIMENSION_SPECIAL);

  const summary_doc = {
    schema_version: CLASSIFICATION_SUMMARY_SCHEMA_VERSION,
    updated_at: now,
    track_count: ids.length,
    metadata_complete,
    metadata_missing,
    decade: decade_counts,
    language: language_counts,
    genre: genre_counts,
    context: context_counts,
    special_type: special_counts,
    language_unconfirmed: count_tracks_with_dimension_value(
      tracks_out,
      DIMENSION_LANGUAGE,
      '未確認'
    ),
    genre_unconfirmed: count_tracks_with_dimension_value(
      tracks_out,
      DIMENSION_GENRE,
      '未確認'
    ),
    context_unconfirmed: ids.length - count_tracks_with_any_context(tracks_out),
    saved_album_special_count: count_tracks_with_dimension_value(
      tracks_out,
      DIMENSION_SPECIAL,
      '完整專輯收藏'
    ),
    manual_override_tracks: count_manual_override_tracks(tracks_out),
    primary_genre: count_primary_genre_tracks(tracks_out),
    subgenre: count_subgenre_tracks(tracks_out),
    genre_taxonomy_version: GENRE_TAXONOMY_VERSION,
  };

  if (options.write !== false) {
    if (!fs.existsSync(CLASSIFICATION_DIR)) {
      fs.mkdirSync(CLASSIFICATION_DIR, { recursive: true });
    }
    write_json_atomic(FILE_CLASSIFICATION_INDEX, index_doc);
    write_json_atomic(FILE_CLASSIFICATION_SUMMARY, summary_doc);
    build_formal_classification_state(index_doc, {
      write: true,
      overrides_doc: overrides_doc,
      g3_f_registry_doc: registry_doc,
    });
  }

  return {
    index_doc,
    summary_doc,
  };
}

function count_tracks_with_any_context(tracks_by_id) {
  let n = 0;
  const ids = Object.keys(tracks_by_id);
  for (let i = 0; i < ids.length; i += 1) {
    const tags = tracks_by_id[ids[i]].tags || [];
    for (let t = 0; t < tags.length; t += 1) {
      if (tags[t].dimension === DIMENSION_CONTEXT) {
        n += 1;
        break;
      }
    }
  }
  return n;
}

function count_manual_override_tracks(tracks_by_id) {
  let n = 0;
  const ids = Object.keys(tracks_by_id);
  for (let i = 0; i < ids.length; i += 1) {
    const tags = tracks_by_id[ids[i]].tags || [];
    for (let t = 0; t < tags.length; t += 1) {
      if (tags[t].is_manual_override) {
        n += 1;
        break;
      }
    }
  }
  return n;
}

export function print_classification_summary(summary) {
  console.log('\n========== Classification Summary ==========');
  console.log('歌曲總數：', summary.track_count);
  console.log('metadata 完整：', summary.metadata_complete);
  console.log('metadata 缺失：', summary.metadata_missing);
  console.log('年代統計：', summary.decade);
  console.log('語言未確認：', summary.language_unconfirmed);
  console.log('曲風未確認：', summary.genre_unconfirmed);
  console.log('無情境標籤：', summary.context_unconfirmed);
  console.log('完整專輯收藏：', summary.saved_album_special_count);
  console.log('含人工覆寫曲目：', summary.manual_override_tracks);
  console.log('==========================================\n');
}

export { DECADE_VALUES };
